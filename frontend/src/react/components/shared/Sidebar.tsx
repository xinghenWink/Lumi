import { ArrowLeft, Coins, Image, LayoutGrid, MessageSquare, Plus, Shield } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BrandMark } from './BrandMark'
import { AccountMenu } from './AccountMenu'
import { CreditBadge } from './CreditBadge'
import { HistorySidebar } from './HistorySidebar'
import { adminGroups } from '../../features/accounts/navigation'
import { useSession } from '../../features/auth/hooks'

export function Sidebar({
  admin = false,
  onNavigate,
}: {
  admin?: boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const { user } = useSession()
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    'flex min-h-10 items-center gap-3 rounded-xl px-3 text-xs transition-colors ' +
    (isActive
      ? 'bg-card font-medium text-primary shadow-sm'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground')
  const links = [
    { to: '/chat', key: 'nav.chat', icon: MessageSquare },
    { to: '/create', key: 'nav.image', icon: Image },
    { to: '/me/images', key: 'nav.gallery', icon: LayoutGrid },
    { to: '/me/credits', key: 'nav.credits', icon: Coins },
  ]
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar px-3.5 pt-6 pb-4 text-foreground">
      <Link to="/chat" onClick={onNavigate} className="mb-7 px-3">
        <BrandMark />
      </Link>
      {admin ? (
        <Link
          to="/chat"
          onClick={onNavigate}
          className="mb-5 flex items-center gap-2 px-3 text-xs text-primary"
        >
          <ArrowLeft size={15} />
          {t('nav.backWorkspace')}
        </Link>
      ) : (
        <Link
          to="/chat"
          onClick={onNavigate}
          className="mx-1 mb-6 flex h-11 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-accent text-xs font-medium text-primary"
        >
          <Plus size={16} />
          {t('react.newCreation')}
        </Link>
      )}
      <nav
        className={
          'flex flex-col gap-1 ' + (admin ? 'min-h-0 flex-1 overflow-y-auto pb-4' : 'mb-5')
        }
        aria-label={t(admin ? 'nav.admin' : 'nav.workspace')}
      >
        {admin ? (
          adminGroups.map((group) => (
            <section key={group.key} className="mb-3">
              <h2 className="mb-2 px-3 text-[10px] font-medium text-muted-foreground">
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
                <Icon size={17} />
                {t(key)}
              </NavLink>
            ))}
            {user?.role === 'admin' ? (
              <Link
                to="/admin"
                onClick={onNavigate}
                className="mt-3 flex min-h-10 items-center gap-3 rounded-xl px-3 text-xs text-muted-foreground hover:bg-muted"
              >
                <Shield size={17} />
                {t('nav.admin')}
              </Link>
            ) : null}
          </>
        )}
      </nav>
      {!admin ? <HistorySidebar onNavigate={onNavigate} /> : null}
      <div className="mt-4 shrink-0 border-t border-border pt-3">
        {!admin ? <CreditBadge onNavigate={onNavigate} /> : null}
        <AccountMenu onNavigate={onNavigate} />
      </div>
    </div>
  )
}
