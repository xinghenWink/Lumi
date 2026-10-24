import { describe, expect, it } from 'vitest'
import { createAppI18n } from '../../react/i18n'
import { addDateRange, safeRedirect, validPassword } from './utils'
import zh from '../../i18n/accounts.zh-CN'
import en from '../../i18n/accounts.en'

describe('account input and navigation', () => {
  it('rejects external redirect targets', () => {
    for (const value of ['https://evil.test', '//evil.test', '/login', '/administrator', ['bad']])
      expect(safeRedirect(value)).toBe('/chat')
    expect(safeRedirect('/admin/users')).toBe('/admin/users')
    expect(safeRedirect('/create/owned-conversation?mode=edit')).toBe(
      '/create/owned-conversation?mode=edit',
    )
    expect(safeRedirect('/create?draft=new')).toBe('/create?draft=new')
    expect(safeRedirect('/create-elsewhere')).toBe('/chat')
  })
  it('validates password characters and builds exclusive UTC date boundaries', () => {
    expect(validPassword('TestOnlyPassword42')).toBe(true)
    expect(validPassword('abcdefgh')).toBe(false)
    expect(validPassword('12345678')).toBe(false)
    const query = new URLSearchParams()
    addDateRange(query, '2026-10-21', '2026-10-22')
    expect(query.get('from')).toBe('2026-10-21T00:00:00.000Z')
    expect(query.get('until')).toBe('2026-10-23T00:00:00.000Z')
  })
  it('provides matching Chinese and English message keys', () => {
    function keys(value: unknown, prefix = ''): string[] {
      if (typeof value !== 'object' || value === null) return [prefix]
      return Object.entries(value)
        .flatMap(([key, nested]) => keys(nested, `${prefix}.${key}`))
        .sort()
    }
    expect(keys(zh)).toEqual(keys(en))
  })
  it('compiles every translated message, including literal email addresses', async () => {
    function paths(value: unknown, prefix = ''): string[] {
      if (typeof value !== 'object' || value === null) return [prefix]
      return Object.entries(value).flatMap(([key, nested]) =>
        paths(nested, prefix ? `${prefix}.${key}` : key),
      )
    }
    const i18n = await createAppI18n()
    for (const locale of ['zh-CN', 'en'] as const) {
      await i18n.changeLanguage(locale)
      for (const key of paths(zh))
        expect(() =>
          i18n.t(key, { page: 1, seconds: 60, name: 'Tester', action: 'event' }),
        ).not.toThrow()
      expect(i18n.t('auth.emailPlaceholder')).toBe('you@example.com')
    }
  })
})
