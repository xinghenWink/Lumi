import { authorized } from './protected'
import { ApiError, noContent } from './transport'
import {
  parseCreditAccount,
  parsePricing,
  parseLedger,
  parseUsage,
  parseRedeemed,
  parseRedemptions,
  parseBatch,
  parseBatches,
  parseCodes,
  type CreditAdjustInput,
  type CreditPricing,
  type RedeemBatchInput,
} from './credit-contracts'

const root = '/api/v1'
const adminUser = (id: string) => `${root}/admin/users/${encodeURIComponent(id)}/credits`
const signalOptions = (signal?: AbortSignal) => (signal ? { signal } : {})
export const credits = {
  account: (id?: string, signal?: AbortSignal) =>
    authorized(
      id ? adminUser(id) : `${root}/me/credits`,
      parseCreditAccount,
      signalOptions(signal),
    ),
  adjust: (id: string, body: CreditAdjustInput, key: string) =>
    authorized(adminUser(id), parseCreditAccount, { method: 'POST', body, idempotencyKey: key }),
  redeem: (code: string, key: string) =>
    authorized(`${root}/me/redeem`, parseRedeemed, {
      method: 'POST',
      body: { code },
      idempotencyKey: key,
    }),
  ledger: (query: URLSearchParams, admin: boolean, signal?: AbortSignal) =>
    authorized(
      `${root}/${admin ? 'admin/credit-ledger' : 'me/credits/ledger'}?${query}`,
      parseLedger,
      signalOptions(signal),
    ),
  usage: (signal?: AbortSignal) =>
    authorized(`${root}/me/credits/stats`, parseUsage, signalOptions(signal)),
  records: (query: URLSearchParams, admin: boolean, signal?: AbortSignal) =>
    authorized(
      `${root}/${admin ? 'admin/redeem-records' : 'me/redeem-records'}?${query}`,
      parseRedemptions,
      signalOptions(signal),
    ),
  pricing: (signal?: AbortSignal) =>
    authorized(`${root}/admin/pricing`, parsePricing, signalOptions(signal)),
  savePricing: (body: CreditPricing) =>
    authorized(`${root}/admin/pricing`, parsePricing, { method: 'PUT', body }),
  batches: (query: URLSearchParams, signal?: AbortSignal) =>
    authorized(`${root}/admin/redeem-batches?${query}`, parseBatches, signalOptions(signal)),
  createBatch: (body: RedeemBatchInput, key: string) =>
    authorized(`${root}/admin/redeem-batches`, parseBatch, {
      method: 'POST',
      body,
      idempotencyKey: key,
    }),
  codes: (query: URLSearchParams, signal?: AbortSignal) =>
    authorized(`${root}/admin/redeem-codes?${query}`, parseCodes, signalOptions(signal)),
  toggleCodes: (ids: string[], enabled: boolean) =>
    authorized(`${root}/admin/redeem-codes`, noContent, {
      method: 'PATCH',
      body: { ids, enabled },
    }),
  deleteCodes: (ids: string[]) =>
    authorized(`${root}/admin/redeem-codes`, noContent, { method: 'DELETE', body: { ids } }),
  export: async (kind: 'ledger' | 'codes', query: URLSearchParams) => {
    const path = kind === 'ledger' ? 'credit-ledger' : 'redeem-codes'
    const blob = await authorized(
      `${root}/admin/${path}/export?${query}`,
      (value) => {
        if (!(value instanceof globalThis.Blob)) throw new ApiError('RESPONSE_INVALID')
        return value
      },
      { responseType: 'blob' },
    )
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `lumi-${path}.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  },
}
