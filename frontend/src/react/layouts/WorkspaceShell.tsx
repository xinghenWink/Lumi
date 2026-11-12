import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from '../components/shared/Sidebar'
import { MobileNavigation } from '../components/shared/MobileNavigation'
import { ThemeToggle } from '../components/shared/ThemeToggle'
import { routeTitle } from '../features/accounts/navigation'
import { usePublicConfig } from '../features/auth/hooks'
import { RuntimeBanner } from '../components/shared/RuntimeBanner'

export function WorkspaceShell() {
  return <ShellLayout admin={false} />
}

export function ShellLayout({ admin }: { admin: boolean }) {
  const location = useLocation()
  const { t } = useTranslation()
  const config = usePublicConfig()
  const title = routeTitle(location.pathname)
  useEffect(() => {
    document.title = `${config.data?.site.name || t('app.name')} · ${t(title)}`
  }, [config.data?.site.name, t, title])
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60 focus:rounded-lg focus:bg-card focus:p-3 focus:shadow-md"
      >
        {t('app.skipLink')}
      </a>
      <aside className="desktop-sidebar hidden h-full w-[264px] shrink-0 border-r border-border lg:block">
        <Sidebar admin={admin} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 sm:px-5">
          <MobileNavigation key={location.key} admin={admin} />
          <Link
            to="/chat"
            className="hidden text-xs text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            {config.data?.site.name || t('app.name')}
          </Link>
          <span className="hidden text-xs text-input sm:block" aria-hidden="true">
            /
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{t(title)}</span>
          <ThemeToggle />
        </header>
        <RuntimeBanner />
        <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
