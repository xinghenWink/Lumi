import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getVersion } from '../../api/client'
import { BrandMark } from '../components/shared/BrandMark'
import { ThemeToggle } from '../components/shared/ThemeToggle'
import { Button } from '../components/ui/button'
import { usePublicConfig } from '../features/auth/hooks'

export function PublicShell() {
  const { t, i18n } = useTranslation()
  const config = usePublicConfig()
  useEffect(() => {
    document.title = t('app.title')
  }, [t])
  const version = useQuery({
    queryKey: ['public', 'version'],
    queryFn: ({ signal }) => getVersion(signal),
  })
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:p-3">
        {t('app.skipLink')}
      </a>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4 sm:px-8">
        <Link to="/" aria-label={t('app.name')}>
          <BrandMark />
        </Link>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('react.changeLanguage')}
            onClick={() => {
              void i18n.changeLanguage(i18n.resolvedLanguage === 'en' ? 'zh-CN' : 'en')
            }}
          >
            {t('react.languageLabel')}
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content" className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-5 text-center text-xs text-muted-foreground">
        {config.data?.site.footer ? <span>{config.data.site.footer}</span> : null}
        <Link to="/terms" className="hover:text-primary">
          {t('auth.terms')}
        </Link>
        <Link to="/privacy" className="hover:text-primary">
          {t('auth.privacy')}
        </Link>
        <span aria-live="polite">
          {version.data
            ? t('react.version', { version: version.data.version })
            : version.isError
              ? t('welcome.unavailable')
              : t('welcome.loading')}
        </span>
      </footer>
    </div>
  )
}
