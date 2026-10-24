import { describe, expect, it } from 'vitest'
import { createAppI18n } from '../../react/i18n'
import {
  defaultCapabilities,
  parsePublicModel,
  parseUpstream,
  parseCapabilities,
} from '../../api/catalog-contracts'
import zh from '../../i18n/catalog.zh-CN'
import en from '../../i18n/catalog.en'
describe('catalog contracts', () => {
  it('keeps provider fields out of the public model DTO', () => {
    const model = parsePublicModel({
      id: 'platform',
      display_name: 'Lumi',
      type: 'chat',
      description: '',
      icon: '',
      sort_order: 0,
      is_default: true,
      capabilities: defaultCapabilities('chat'),
      api_key: 'must-not-display',
      base_url: 'https://private.invalid',
      routes: [{ upstream_model_name: 'wire-model' }],
    })
    expect(JSON.stringify(model)).not.toMatch(/must-not-display|private.invalid|wire-model/)
  })
  it('rejects unknown kinds, unsafe revisions and capability values', () => {
    expect(() => parsePublicModel({ id: 'model', type: 'unknown' })).toThrow()
    expect(() =>
      parseCapabilities({ ...defaultCapabilities('image'), qualities: ['unverified'] }),
    ).toThrow()
    expect(() => parseUpstream({ version: 2 ** 54 })).toThrow()
    expect(() =>
      parseCapabilities({ ...defaultCapabilities('chat'), max_context_tokens: 1.5 }),
    ).toThrow()
    expect(defaultCapabilities('image').supports_edit).toBe(false)
  })
  it('compiles matching Chinese and English messages', async () => {
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
          i18n.t(path, { name: 'Lumi', id: 'model', index: 1, count: 2, ms: 100 }),
        ).not.toThrow()
    }
  })
})
