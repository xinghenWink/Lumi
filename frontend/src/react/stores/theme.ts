import { createStore } from 'zustand/vanilla'

export type Theme = 'light' | 'dark' | 'system'
export interface ThemeState {
  preference: Theme
  setTheme(value: Theme): void
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
