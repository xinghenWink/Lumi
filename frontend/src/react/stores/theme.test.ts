import { afterEach, expect, it, vi } from 'vitest'
import { createThemeStore, effectiveTheme } from './theme'

afterEach(() => {
  localStorage.clear()
})
it('preserves system preference and responds to OS changes without persisting credentials', () => {
  localStorage.setItem('lumi.theme', 'system')
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const theme = createThemeStore()
  expect(effectiveTheme(theme.getState())).toBe('dark')
  theme.getState().setSystemDark(false)
  expect(effectiveTheme(theme.getState())).toBe('light')
  expect(localStorage.getItem('lumi.theme')).toBe('system')
  theme.getState().setTheme('dark')
  theme.getState().setSystemDark(false)
  expect(effectiveTheme(theme.getState())).toBe('dark')
  expect(Object.keys(localStorage)).toEqual(['lumi.theme'])
})
