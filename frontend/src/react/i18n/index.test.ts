import { describe, expect, it } from 'vitest'
import { loadRouteCopy } from './route-copy'
import { createAppI18n } from './index'
import { messages } from '../../i18n/resources'
import zhCN from './zh-CN'
import en from './en'
import { auditActions, auditTargets } from '../../api/audit-options'
import canvasZh from '../../i18n/canvas.zh-CN'
import canvasEn from '../../i18n/canvas.en'
import { loadCanvasCatalog } from '../features/canvas/i18n'

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
        /['"]((?:react|nav|app|auth|common|chat|images|credits|ops|legal|notFound|errors|welcome|admin|settings|audit|catalog|canvas)\.[A-Za-z]\w*(?:\.[A-Za-z]\w*)*)['"]/g,
      ))
        if (match[1]) keys.add(match[1])
    }
    for (const locale of ['zh-CN', 'en'] as const) {
      const language = await createAppI18n(locale)
      // Canvas copy is loaded by the canvas routes rather than with the shell.
      await loadCanvasCatalog(language, locale)
      await loadRouteCopy(language, 'admin')
      await loadRouteCopy(language, 'legal')
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
    expect(paths(zhCN.react).sort()).toEqual(paths(en.react).sort())
    expect(paths(canvasZh).sort()).toEqual(paths(canvasEn).sort())
    expect(language.t('workspace.greeting', { name: '小明' })).toBe('你好，小明。')
    expect(language.t('auth.emailPlaceholder')).toBe('you@example.com')
    expect(language.exists('admin.console')).toBe(false)
    expect(language.exists('legal.termsTitle')).toBe(false)
    await loadRouteCopy(language, 'admin')
    await loadRouteCopy(language, 'legal')
    for (const key of paths(messages['zh-CN'])) expect(language.exists(key)).toBe(true)
    await language.changeLanguage('en')
    expect(language.t('workspace.greeting', { name: 'Alex' })).toBe('Hello, Alex.')
    expect(language.t('react.version', { version: 'test-version' })).toBe('Lumi · test-version')
  })
})

describe('canvas catalog', () => {
  it('loads lazily without replacing shell copy and follows language changes', async () => {
    const language = await createAppI18n()
    expect(language.exists('canvas.list.heading')).toBe(false)
    await loadCanvasCatalog(language, 'zh-CN')
    expect(language.t('canvas.list.heading')).toBe('无限画布')
    expect(language.t('errors.CANVAS_CONFLICT')).not.toBe('errors.CANVAS_CONFLICT')
    expect(language.exists('errors.INVALID_INPUT')).toBe(true)
    await language.changeLanguage('en')
    await loadCanvasCatalog(language, 'en')
    expect(language.t('canvas.list.nodes', { count: 3 })).toContain('3')
    expect(language.exists('errors.INVALID_INPUT')).toBe(true)
  })
})
