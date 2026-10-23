import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { i18n } from 'i18next'
import type { AppRuntime } from './runtime'
import { RuntimeContext, useRuntime } from './context'

function Appearance({ children }: { children: ReactNode }) {
  const { themeStore } = useRuntime()
  const preference = useStore(themeStore, (state) => state.preference)
  const { i18n, t } = useTranslation()
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme =
      preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
    document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN'
    document.title = t('app.title')
  }, [preference, systemDark, i18n.resolvedLanguage, t])
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
