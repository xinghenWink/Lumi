import { useQuery } from '@tanstack/react-query'
import { Moon, Sparkles, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { getVersion } from '../../api/client'
import { Button } from '../components/ui/button'
import { useRuntime } from '../app/context'

export default function FoundationPage() {
  const { t, i18n } = useTranslation()
  const { themeStore } = useRuntime()
  const preference = useStore(themeStore, (state) => state.preference)
  const setTheme = useStore(themeStore, (state) => state.setTheme)
  const version = useQuery({
    queryKey: ['public', 'version'],
    queryFn: ({ signal }) => getVersion(signal),
  })
  const dark = preference === 'dark'
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:p-3">
        {t('app.skipLink')}
      </a>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5 sm:px-8">
        <div className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles size={20} />
          </span>
          <span className="text-xl">{t('app.name')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('react.changeLanguage')}
            onClick={() => {
              void i18n.changeLanguage(i18n.resolvedLanguage === 'en' ? 'zh-CN' : 'en')
            }}
          >
            {t('react.languageLabel')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(dark ? 'react.switchLight' : 'react.switchDark')}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-5 px-6 py-20 text-center"
      >
        <div className="grid size-14 place-items-center rounded-2xl bg-accent text-primary">
          <Sparkles size={28} strokeWidth={1.6} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('react.title')}</h1>
        <p className="max-w-md text-sm leading-7 text-muted-foreground">{t('react.description')}</p>
      </main>
      <footer className="px-5 py-5 text-center text-xs text-muted-foreground" aria-live="polite">
        {version.isError
          ? t('welcome.unavailable')
          : version.data
            ? t('react.version', { version: version.data.version })
            : t('welcome.loading')}
      </footer>
    </div>
  )
}
