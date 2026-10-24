import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppI18n } from '../../react/i18n'
import {
  parseCreditAccount,
  parseLedger,
  parseUsage,
  parseRedeemed,
} from '../../api/credit-contracts'
import { request } from '../../api/transport'
import { createMutationKey } from '../../react/features/accounts/resources'
import zh from '../../i18n/credits.zh-CN'
import en from '../../i18n/credits.en'

const account = {
  user_id: '018a0000-0000-7000-8000-000000000001',
  permanent_balance: 10,
  daily_balance: 5,
  total: 15,
  daily_reset_on: '2026-10-22',
  next_reset_at: '2026-10-22T16:00:00Z',
  timezone: 'Asia/Shanghai',
  version: 1,
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('credit contracts', () => {
  it('rejects inconsistent totals unsafe integers and negative buckets', () => {
    expect(parseCreditAccount(account).total).toBe(15)
    for (const value of [
      { ...account, total: 16 },
      { ...account, daily_balance: -1 },
      { ...account, permanent_balance: 1e15, total: 1e15 + 5 },
      { ...account, version: 1.5 },
    ]) {
      expect(() => parseCreditAccount(value)).toThrow('RESPONSE_INVALID')
    }
  })
  it('keeps negative ledger changes but rejects unknown money event types', () => {
    const row = {
      id: 'entry',
      user_id: 'user',
      type: 'image_charge',
      bucket: 'daily',
      delta: -5,
      bucket_balance_after: 0,
      total_after: 10,
      ref_type: 'image_task',
      ref_id: 'task',
      operator_id: null,
      note: '',
      created_at: '2026-10-22T00:00:00Z',
    }
    expect(parseLedger({ items: [row], next_cursor: '' }).items[0]?.delta).toBe(-5)
    expect(() =>
      parseLedger({ items: [{ ...row, type: 'untrusted_credit' }], next_cursor: '' }),
    ).toThrow()
  })
  it('requires the complete real thirty-day series and validates nested redemption balances', () => {
    const usage = {
      days: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-10-${index + 1}`,
        consumed: 0,
      })),
      month_consumed: 0,
      images_by_quality: { low: 0, medium: 0, high: 0 },
      timezone: 'Asia/Shanghai',
    }
    expect(parseUsage(usage).month_consumed).toBe(0)
    expect(() => parseUsage({ ...usage, days: [] })).toThrow()
    expect(() =>
      parseRedeemed({ credits: 5, account: { ...account, total: 20 }, record: {} }),
    ).toThrow()
  })
  it('keeps one key for uncertain retries and rotates after confirmation or changed input', () => {
    const key = createMutationKey()
    const first = key.forPayload({ amount: 10, note: 'Support' })
    expect(key.forPayload({ amount: 10, note: 'Support' })).toBe(first)
    const second = key.forPayload({ amount: 11, note: 'Support' })
    expect(second).not.toBe(first)
    key.complete()
    expect(key.forPayload({ amount: 11, note: 'Support' })).not.toBe(second)
  })
  it('sends the original operation key together with authorization and CSRF headers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(account), { headers: { 'Content-Type': 'application/json' } }),
      )
    vi.stubGlobal('fetch', fetcher)
    await request('/api/v1/me/redeem', parseCreditAccount, {
      method: 'POST',
      body: { code: 'test-code' },
      token: 'test-token',
      idempotencyKey: 'test-operation-123',
    })
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Idempotency-Key')).toBe('test-operation-123')
    expect(headers.get('Authorization')).toBe('Bearer test-token')
    expect(headers.get('X-Lumi-CSRF')).toBe('1')
  })
  it('refuses a JSON response masquerading as a CSV download', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } })),
    )
    await expect(request('/export', (value) => value, { responseType: 'blob' })).rejects.toThrow(
      'RESPONSE_INVALID',
    )
  })
  it('provides matching translatable Chinese and English credit messages', async () => {
    function paths(value: unknown, prefix = ''): string[] {
      if (typeof value !== 'object' || value === null) return [prefix]
      return Object.entries(value)
        .flatMap(([key, nested]) => paths(nested, prefix ? `${prefix}.${key}` : key))
        .sort()
    }
    expect(paths(zh)).toEqual(paths(en))
    const i18n = await createAppI18n()
    for (const locale of ['zh-CN', 'en'] as const) {
      await i18n.changeLanguage(locale)
      for (const path of paths(zh))
        expect(() =>
          i18n.t(path, {
            time: '12:00',
            zone: 'Asia/Shanghai',
            amount: 5,
            seconds: 10,
            daily: 5,
            permanent: 10,
            date: '2026-10-22',
            count: 100,
          }),
        ).not.toThrow()
    }
  })
})
