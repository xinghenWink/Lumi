import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSession, usePublicConfig } from './hooks'
import { PageStatus } from '../../components/shared/PageStatus'
import { safeRedirect } from '../../../features/accounts/utils'
import { useRuntime } from '../../app/context'
import { Button } from '../../components/ui/button'
import { ApiNotice } from '../../components/shared/ApiNotice'

export function GuestBoundary() {
  const session = useSession()
  const [params] = useSearchParams()
  if (!session.initialized) return <PageStatus />
  if (session.user) return <Navigate to={safeRedirect(params.get('redirect'))} replace />
  return <Outlet />
}

export function SessionBoundary() {
  const session = useSession()
  const location = useLocation()
  const config = usePublicConfig()
  const { i18n, t } = useTranslation()
  const runtime = useRuntime()
  const logout = useMutation({ mutationFn: () => runtime.session.logout() })
  useEffect(() => {
    if (session.user?.locale) void i18n.changeLanguage(session.user.locale)
  }, [session.user?.locale, i18n])
  if (!session.initialized) return <PageStatus />
  if (!session.user)
    return (
      <Navigate
        to={
          runtime.sessionExitTarget ||
          '/login?redirect=' +
            encodeURIComponent(location.pathname + location.search + location.hash)
        }
        replace
      />
    )
  if (config.data?.maintenance && session.user.role !== 'admin')
    return (
      <section className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">{t('ops.maintenanceTitle')}</h1>
        <p className="text-muted-foreground">{t('ops.maintenanceBody')}</p>
        <ApiNotice error={logout.error} />
        <Button
          type="button"
          onClick={() => {
            void config.refetch()
          }}
        >
          {t('ops.reload')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={logout.isPending}
          onClick={() => {
            logout.mutate()
          }}
        >
          {t('auth.logout')}
        </Button>
      </section>
    )
  return <Outlet />
}

export function AdminBoundary() {
  const session = useSession()
  return session.user?.role === 'admin' ? <Outlet /> : <Navigate to="/chat" replace />
}
