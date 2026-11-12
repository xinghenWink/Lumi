import { ArrowLeft, Coins, Image, LayoutGrid, MessageSquare, Plus, Shield } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BrandMark } from './BrandMark'
import { AccountMenu } from './AccountMenu'
import { CreditBadge } from './CreditBadge'
import { HistorySidebar } from './HistorySidebar'
import { adminGroups } from '../../features/accounts/navigation'
import { useSession } from '../../features/auth/hooks'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  'group/nav flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ' +
  (isActive
    ? 'bg-card font-medium text-foreground shadow-xs [&_svg]:text-primary'
    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground')

export function Sidebar({
  admin = false,
  onNavigate,
}: {
  admin?: boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const { user } = useSession()
  const image = useLocation().pathname.startsWith('/create')
  const links = [
    { to: '/chat', key: 'nav.chat', icon: MessageSquare },
    { to: '/create', key: 'nav.image', icon: Image },
    { to: '/me/images', key: 'nav.gallery', icon: LayoutGrid },
    { to: '/me/credits', key: 'nav.credits', icon: Coins },
  ]
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar px-3 pt-4 pb-3 text-foreground">
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
          to={image ? '/create' : '/chat'}
          onClick={onNavigate}
          className="mb-4 flex h-10 items-center gap-2 rounded-xl border border-input bg-card px-3 text-[13px] font-medium shadow-xs transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="grid size-5 place-items-center rounded-md bg-primary text-primary-foreground">
            <Plus size={13} strokeWidth={2.4} />
          </span>
          {t('react.newCreation')}
        </Link>
      )}
      <nav
        className={
          'flex flex-col gap-0.5 ' + (admin ? 'min-h-0 flex-1 overflow-y-auto pb-4' : 'mb-3')
        }
        aria-label={t(admin ? 'nav.admin' : 'nav.workspace')}
      >
        {admin ? (
          adminGroups.map((group) => (
            <section key={group.key} className="mb-3">
              <h2 className="mb-1 px-2.5 text-2xs font-medium text-muted-foreground">
                {t(group.key)}
              </h2>
              {group.items.map(({ path, key, icon: Icon }) => (
                <NavLink key={path} to={path} onClick={onNavigate} className={linkClass}>
                  <Icon size={16} />
                  <span>{t(key)}</span>
                </NavLink>
              ))}
            </section>
          ))
        ) : (
          <>
            {links.map(({ to, key, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={onNavigate} className={linkClass}>
                <Icon size={16} />
                {t(key)}
              </NavLink>
            ))}
            {user?.role === 'admin' ? (
              <Link
                to="/admin"
                onClick={onNavigate}
                className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <Shield size={16} />
                {t('nav.admin')}
              </Link>
            ) : null}
          </>
        )}
      </nav>
      {!admin ? <HistorySidebar onNavigate={onNavigate} /> : null}
      <div className="mt-3 shrink-0 border-t border-border pt-3">
        {!admin ? <CreditBadge onNavigate={onNavigate} /> : null}
        <AccountMenu onNavigate={onNavigate} />
      </div>
    </div>
  )
}
