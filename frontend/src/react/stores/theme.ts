import { createStore } from 'zustand/vanilla'

export type Theme = 'light' | 'dark' | 'system'
export interface ThemeState {
  preference: Theme
  systemDark: boolean
  setTheme(value: Theme): void
  setSystemDark(value: boolean): void
}

export function effectiveTheme(
  state: Pick<ThemeState, 'preference' | 'systemDark'>,
): 'light' | 'dark' {
  return state.preference === 'system' ? (state.systemDark ? 'dark' : 'light') : state.preference
}

export function createThemeStore() {
  let preference: Theme = 'light'
  try {
    const value = localStorage.getItem('lumi.theme')
    if (value === 'light' || value === 'dark' || value === 'system') preference = value
  } catch {
    /* The theme remains usable when browser storage is unavailable. */
  }
  return createStore<ThemeState>()((set) => ({
    preference,
    systemDark:
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    setSystemDark: (systemDark) => set({ systemDark }),
    setTheme(value) {
      set({ preference: value })
      try {
        localStorage.setItem('lumi.theme', value)
      } catch {
        /* Persist appearance only, never credentials or private drafts. */
      }
    },
  }))
}
