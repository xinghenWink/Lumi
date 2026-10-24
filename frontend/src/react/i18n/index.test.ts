import { describe, expect, it } from 'vitest'
import { createAppI18n } from './index'
import { messages } from '../../i18n/resources'
import { auditActions, auditTargets } from '../../api/audit-options'

function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('shared translation compatibility', () => {
  it('resolves user-facing static keys in both candidate languages', async () => {
    const sources = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const keys = new Set<string>()
    for (const [file, source] of Object.entries(sources)) {
      if (file.endsWith('.test.ts') || typeof source !== 'string') continue
      for (const match of source.matchAll(
        /['"]((?:react|nav|app|auth|common|chat|images|credits|ops|legal|notFound|errors|welcome|admin|settings|audit|catalog)\.[A-Za-z]\w*(?:\.[A-Za-z]\w*)*)['"]/g,
      ))
        if (match[1]) keys.add(match[1])
    }
    for (const locale of ['zh-CN', 'en'] as const) {
      const language = await createAppI18n(locale)
      for (const key of keys) expect(language.exists(key), `${locale}: ${key}`).toBe(true)
      for (const action of auditActions)
        expect(language.exists('audit.actions.' + action), `${locale}: ${action}`).toBe(true)
      for (const target of auditTargets)
        expect(language.exists('audit.types.' + target), `${locale}: ${target}`).toBe(true)
    }
  })
  it('retains language keys, interpolation and literal email escapes', async () => {
    const language = await createAppI18n()
    expect(paths(messages['zh-CN']).sort()).toEqual(paths(messages.en).sort())
    expect(language.t('workspace.greeting', { name: '小明' })).toBe('你好，小明。')
    expect(language.t('auth.emailPlaceholder')).toBe('you@example.com')
    for (const key of paths(messages['zh-CN'])) expect(language.exists(key)).toBe(true)
    await language.changeLanguage('en')
    expect(language.t('workspace.greeting', { name: 'Alex' })).toBe('Hello, Alex.')
    expect(language.t('react.version', { version: 'test-version' })).toBe('Lumi · test-version')
  })
})
