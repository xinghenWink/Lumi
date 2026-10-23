import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Coins, LogOut, MoreHorizontal, Shield, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '../../features/auth/hooks'
import { useRuntime } from '../../app/context'
import { ApiNotice } from './ApiNotice'

export function AccountMenu({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t } = useTranslation()
  const { user } = useSession()
  const runtime = useRuntime()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const item =
    'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm outline-none focus:bg-accent focus:text-primary'
  async function logout() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await runtime.session.logout()
      onNavigate?.()
      await navigate('/login', { replace: true })
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="relative">
      <ApiNotice error={error} />
      <Dropdown.Root modal={false}>
        <Dropdown.Trigger
          className="flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t('nav.userMenu')}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-primary">
            {Array.from(user?.nickname || user?.email || '')[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-xs font-semibold">{user?.nickname}</strong>
            <span className="block text-[11px] text-muted-foreground">
              {t(user?.role === 'admin' ? 'admin.users.admin' : 'admin.users.user')}
            </span>
          </span>
          <MoreHorizontal size={17} />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            side="top"
            align="start"
            sideOffset={10}
            collisionPadding={12}
            className="z-50 w-[240px] max-w-[min(264px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl"
          >
            <p className="truncate px-3 py-2 text-xs text-muted-foreground">{user?.email}</p>
            <Dropdown.Separator className="my-1 h-px bg-border" />
            {[
              { to: '/me', key: 'nav.account', icon: UserRound },
              { to: '/me/security', key: 'nav.security', icon: Shield },
              { to: '/me/credits', key: 'nav.credits', icon: Coins },
              ...(user?.role === 'admin' ? [{ to: '/admin', key: 'nav.admin', icon: Shield }] : []),
            ].map(({ to, key, icon: Icon }) => (
              <Dropdown.Item key={to} asChild onSelect={onNavigate}>
                <Link to={to} className={item}>
                  <Icon size={16} />
                  {t(key)}
                </Link>
              </Dropdown.Item>
            ))}
            <Dropdown.Separator className="my-1 h-px bg-border" />
            <Dropdown.Item
              className={item + ' text-destructive'}
              disabled={busy}
              onSelect={() => {
                void logout()
              }}
            >
              <LogOut size={16} />
              {t(busy ? 'auth.loggingOut' : 'auth.logout')}
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  )
}
