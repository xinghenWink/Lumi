import {
  ArrowLeft,
  Coins,
  Image,
  LayoutGrid,
  MessageSquare,
  Plus,
  Shield,
  Workflow,
} from 'lucide-react'
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
import { BrandMark } from './BrandMark'
import { AccountMenu } from './AccountMenu'
import { CreditBadge } from './CreditBadge'
import { HistorySidebar } from './HistorySidebar'
import { adminGroups } from '../../features/accounts/navigation'
import { useSession } from '../../features/auth/hooks'

const navigationItem =
  'min-h-9 text-[13px] aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:shadow-xs aria-[current=page]:[&_svg]:text-primary'

export function Sidebar({
  admin = false,
  onNavigate,
}: {
  admin?: boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const { user } = useSession()
  const path = useLocation().pathname
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
        <Link
          to="/chat"
          onClick={onNavigate}
          className="mb-5 flex h-10 items-center rounded-lg px-1.5"
        >
          <BrandMark />
        </Link>
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
            className="mb-4 flex h-10 items-center gap-2 rounded-xl border border-input bg-card px-3 text-[13px] font-medium shadow-xs transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="grid size-5 place-items-center rounded-md bg-primary text-primary-foreground">
              <Plus size={13} strokeWidth={2.4} />
            </span>
            {t('react.newCreation')}
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
                  <SidebarMenuButton asChild className={navigationItem}>
                    <NavLink to={to} onClick={onNavigate}>
                      <Icon size={16} />
                      {t(key)}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {user?.role === 'admin' ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className={navigationItem}>
                    <Link to="/admin" onClick={onNavigate}>
                      <Shield size={16} />
                      {t('nav.admin')}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          )}
        </nav>
        {!admin ? <HistorySidebar onNavigate={onNavigate} /> : null}
      </SidebarContent>
      <SidebarFooter className="mt-3 shrink-0 gap-0 p-0">
        <Separator className="mb-3" />
        {!admin ? <CreditBadge onNavigate={onNavigate} /> : null}
        <AccountMenu onNavigate={onNavigate} />
      </SidebarFooter>
    </SidebarFrame>
  )
}
