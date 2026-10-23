import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { i18n } from 'i18next'
import type { AppRuntime } from './runtime'
import { RuntimeContext, useRuntime } from './context'
import { effectiveTheme } from '../stores/theme'

function Appearance({ children }: { children: ReactNode }) {
  const { themeStore } = useRuntime()
  const current = useStore(themeStore, effectiveTheme)
  const { i18n } = useTranslation()
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent) =>
      themeStore.getState().setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [themeStore])
  useEffect(() => {
    document.documentElement.dataset.theme = current
    document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN'
  }, [current, i18n.resolvedLanguage])
  return children
}

export function AppProviders({
  runtime,
  language,
  children,
}: {
  runtime: AppRuntime
  language: i18n
  children: ReactNode
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={runtime.queryClient}>
          <Appearance>{children}</Appearance>
        </QueryClientProvider>
      </I18nextProvider>
    </RuntimeContext.Provider>
  )
}
