import { describe, expect, it } from 'vitest'
import { createAppI18n } from './index'
import { messages } from '../../i18n/resources'

function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('shared translation compatibility', () => {
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
