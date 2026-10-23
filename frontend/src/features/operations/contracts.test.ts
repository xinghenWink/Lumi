import { describe, it, expect } from 'vitest'
import { parsePreferences, parseOperations, parseAnnouncement } from '../../api/operations'
import zh from '../../i18n/operations.zh-CN'
import en from '../../i18n/operations.en'
describe('M6 public contracts', () => {
  it('rejects malformed preferences and strips secret persistence fields', () => {
    expect(() =>
      parsePreferences({
        theme: 'custom',
        instructions: '',
        image_quality: 'medium',
        image_ratio: '1:1',
        image_count: 1,
      }),
    ).toThrow('RESPONSE_INVALID')
    const v = parseOperations({
      maintenance: false,
      turnstile_enabled: true,
      turnstile_site_key: 'public',
      turnstile_hostname: 'lumi.test',
      turnstile_secret_configured: true,
      register_per_ip_day: 5,
      circuit_failures: 5,
      circuit_seconds: 60,
      sensitive_words: [],
      turnstile_secret_encrypted: 'must-not-escape',
    })
    expect(JSON.stringify(v)).not.toContain('must-not-escape')
    expect(() => parseOperations({ ...v, circuit_seconds: -1 })).toThrow('RESPONSE_INVALID')
    expect(() =>
      parseAnnouncement({
        id: 'a',
        content: 'b',
        starts_at: 'c',
        ends_at: null,
        enabled: 'true',
        version: 1,
        created_at: 'd',
      }),
    ).toThrow('RESPONSE_INVALID')
  })
  it('provides matching Chinese and English UI and error keys', () => {
    expect(Object.keys(zh.ops).sort()).toEqual(Object.keys(en.ops).sort())
    expect(Object.keys(zh.errors).sort()).toEqual(Object.keys(en.errors).sort())
    expect(Object.keys(zh.nav).sort()).toEqual(Object.keys(en.nav).sort())
  })
})
