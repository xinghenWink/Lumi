import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type Theme = 'light' | 'dark' | 'system'
export const useThemeStore = defineStore('theme', () => {
  const preference = ref<Theme>('light')
  const systemDark = ref(false)
  const current = computed(() =>
    preference.value === 'system' ? (systemDark.value ? 'dark' : 'light') : preference.value,
  )
  function initialize() {
    try {
      const saved = localStorage.getItem('lumi.theme')
      if (saved === 'light' || saved === 'dark' || saved === 'system') preference.value = saved
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }
  function set(value: Theme) {
    preference.value = value
    try {
      localStorage.setItem('lumi.theme', value)
    } catch {
      /* The active theme still works without persistence. */
    }
  }
  function toggle() {
    set(current.value === 'light' ? 'dark' : 'light')
  }
  return { preference, systemDark, current, initialize, set, toggle }
})
