import {
  ArrowLeft,
  Coins,
  Image,
  LayoutGrid,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Shield,
  Workflow,
} from 'lucide-react'
import { useId } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Sidebar as SidebarFrame,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../ui/sidebar'
import { Separator } from '../ui/separator'
import { Button } from '../ui/button'
import { BrandMark } from './BrandMark'
import { AccountMenu } from './AccountMenu'
import { CreditBadge } from './CreditBadge'
import { HistorySidebar } from './HistorySidebar'
import { adminGroups } from '../../features/accounts/navigation'
import { useSession } from '../../features/auth/hooks'
import { cn } from '../../lib/utils'

const navigationItem =
  'min-h-9 text-[13px] aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:shadow-xs aria-[current=page]:[&_svg]:text-primary'

export function Sidebar({
  admin = false,
  collapsed = false,
  onNavigate,
  onToggle,
}: {
  admin?: boolean
  collapsed?: boolean
  onNavigate?: () => void
  onToggle?: () => void
}) {
  const { t } = useTranslation()
  const { user } = useSession()
  const path = useLocation().pathname
  const historyId = useId()
  const toggleLabel = t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const compactLabel = collapsed ? 'sr-only' : undefined
  const linkClass = cn(navigationItem, collapsed && 'justify-center px-0')
  const fresh = path.startsWith('/create')
    ? '/create'
    : path.startsWith('/canvas')
      ? '/canvas/new'
      : '/chat'
  const links = [
    { to: '/chat', key: 'nav.chat', icon: MessageSquare },
    { to: '/create', key: 'nav.image', icon: Image },
    { to: '/canvas', key: 'nav.canvas', icon: Workflow },
    { to: '/me/images', key: 'nav.gallery', icon: LayoutGrid },
    { to: '/me/credits', key: 'nav.credits', icon: Coins },
  ]
  return (
    <SidebarFrame className="px-3 pt-4 pb-3">
      <SidebarHeader className="gap-0 p-0">
        <div className={cn('mb-5 flex h-10 items-center gap-2', collapsed && 'justify-center')}>
          {collapsed ? null : (
            <Link
              to="/chat"
              onClick={onNavigate}
              className="flex h-10 min-w-0 flex-1 items-center rounded-lg px-1.5"
            >
              <BrandMark />
            </Link>
          )}
          {onToggle ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              aria-controls={historyId}
              title={toggleLabel}
              onClick={onToggle}
            >
              <ToggleIcon size={18} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {admin ? (
          <Link
            to="/chat"
            onClick={onNavigate}
            className="mb-4 flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <ArrowLeft size={15} />
            {t('nav.backWorkspace')}
          </Link>
        ) : (
          <Link
            to={fresh}
            onClick={onNavigate}
            className={cn(
              'mb-4 flex h-10 items-center gap-2 rounded-xl border border-input bg-card text-[13px] font-medium shadow-xs transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              collapsed ? 'justify-center' : 'px-3',
            )}
            title={collapsed ? t('react.newCreation') : undefined}
          >
            <span className="grid size-5 place-items-center rounded-md bg-primary text-primary-foreground">
              <Plus size={13} strokeWidth={2.4} />
            </span>
            <span className={compactLabel}>{t('react.newCreation')}</span>
          </Link>
        )}
      </SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden p-0">
        <nav
          className={
            'flex flex-col gap-0.5 ' +
            (admin ? 'min-h-0 flex-1 overflow-y-auto pb-4' : 'mb-3 shrink-0')
          }
          aria-label={t(admin ? 'nav.admin' : 'nav.workspace')}
        >
          {admin ? (
            adminGroups.map((group) => (
              <SidebarGroup key={group.key} className="mb-3 p-0">
                <SidebarGroupLabel asChild className="mb-1 h-auto px-2.5 text-2xs">
                  <h2>{t(group.key)}</h2>
                </SidebarGroupLabel>
                <SidebarMenu>
                  {group.items.map(({ path, key, icon: Icon }) => (
                    <SidebarMenuItem key={path}>
                      <SidebarMenuButton asChild className={navigationItem}>
                        <NavLink to={path} onClick={onNavigate}>
                          <Icon size={16} />
                          <span>{t(key)}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))
          ) : (
            <SidebarMenu>
              {links.map(({ to, key, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild className={linkClass}>
                    <NavLink to={to} onClick={onNavigate} title={collapsed ? t(key) : undefined}>
                      <Icon size={16} />
                      <span className={compactLabel}>{t(key)}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {user?.role === 'admin' ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className={linkClass}>
                    <Link
                      to="/admin"
                      onClick={onNavigate}
                      title={collapsed ? t('nav.admin') : undefined}
                    >
                      <Shield size={16} />
                      <span className={compactLabel}>{t('nav.admin')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          )}
        </nav>
        {!admin ? (
          <div id={historyId} className={collapsed ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
            <HistorySidebar onNavigate={onNavigate} />
          </div>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="mt-3 shrink-0 gap-0 p-0">
        <Separator className="mb-3" />
        {!admin && !collapsed ? <CreditBadge onNavigate={onNavigate} /> : null}
        <AccountMenu compact={collapsed} onNavigate={onNavigate} />
      </SidebarFooter>
    </SidebarFrame>
  )
}
