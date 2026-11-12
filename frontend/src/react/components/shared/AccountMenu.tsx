import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Coins, LogOut, MoreHorizontal, Shield, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '../../features/auth/hooks'
import { useRuntime } from '../../app/context'
import { ApiNotice } from './ApiNotice'
import { UserAvatar } from './UserAvatar'

export function AccountMenu({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t } = useTranslation()
  const { user } = useSession()
  const runtime = useRuntime()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const item =
    'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none transition-colors focus:bg-muted [&_svg]:text-muted-foreground'
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
          className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted/70"
          aria-label={t('nav.userMenu')}
        >
          <UserAvatar />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-[13px] font-medium">{user?.nickname}</strong>
            <span className="block text-2xs text-muted-foreground">
              {t(user?.role === 'admin' ? 'admin.users.admin' : 'admin.users.user')}
            </span>
          </span>
          <MoreHorizontal size={16} className="text-muted-foreground" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            side="top"
            align="start"
            sideOffset={10}
            collisionPadding={12}
            className="z-50 w-[240px] max-w-[min(264px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border bg-card p-1 text-foreground shadow-lg animate-rise-in"
          >
            <p className="truncate px-2.5 py-2 text-xs text-muted-foreground">{user?.email}</p>
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
              className={item + ' text-destructive [&_svg]:text-destructive'}
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
