import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from '../components/shared/Sidebar'
import { SidebarInset } from '../components/ui/sidebar'
import { MobileNavigation } from '../components/shared/MobileNavigation'
import { LanguageSwitcher } from '../components/shared/LanguageSwitcher'
import { ThemeToggle } from '../components/shared/ThemeToggle'
import { routeTitle } from '../features/accounts/navigation'
import { usePublicConfig } from '../features/auth/hooks'
import { AnnouncementButton } from '../components/shared/AnnouncementButton'
import { DropLayer } from '../components/shared/DropLayer'
import { cn } from '../lib/utils'

const sidebarPreference = 'lumi.workspaceSidebarCollapsed'

function readSidebarPreference() {
  try {
    return localStorage.getItem(sidebarPreference) === 'true'
  } catch {
    return false
  }
}

export function WorkspaceShell() {
  return <ShellLayout admin={false} />
}

export function ShellLayout({ admin }: { admin: boolean }) {
  const location = useLocation()
  const { t } = useTranslation()
  const config = usePublicConfig()
  const title = routeTitle(location.pathname)
  const [collapsed, setCollapsed] = useState(() => !admin && readSidebarPreference())
  const desktopSidebar = useRef<HTMLDivElement>(null)
  const searchOnExpand = useRef(false)
  const focusSearch = useCallback(() => {
    desktopSidebar.current?.querySelector<HTMLInputElement>('[data-history-search]')?.focus()
  }, [])
  const changeSidebar = useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      localStorage.setItem(sidebarPreference, String(next))
    } catch {
      // The sidebar can still be toggled without browser storage.
    }
  }, [])
  const desktopSearch = useCallback(() => {
    if (collapsed) {
      searchOnExpand.current = true
      changeSidebar(false)
    } else {
      focusSearch()
    }
  }, [collapsed, changeSidebar, focusSearch])
  useEffect(() => {
    if (collapsed || !searchOnExpand.current) return
    searchOnExpand.current = false
    focusSearch()
  }, [collapsed, focusSearch])
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
      <div
        ref={desktopSidebar}
        className={cn(
          'desktop-sidebar hidden h-full shrink-0 border-r border-border lg:block',
          collapsed ? 'w-16' : 'w-[264px]',
        )}
      >
        <Sidebar
          admin={admin}
          collapsed={collapsed}
          {...(admin ? {} : { onToggle: () => changeSidebar(!collapsed) })}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 sm:px-5">
          <MobileNavigation key={location.key} admin={admin} onDesktopSearch={desktopSearch} />
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
          <LanguageSwitcher />
          <ThemeToggle />
          <AnnouncementButton />
        </header>
        <SidebarInset
          id="main-content"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
        >
          <DropLayer>
            <Outlet />
          </DropLayer>
        </SidebarInset>
      </div>
    </div>
  )
}
