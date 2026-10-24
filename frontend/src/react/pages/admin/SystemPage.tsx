import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { operations } from '../../../api/operations'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { AdminPage } from '../../components/admin/AdminPage'
import { Panel } from '../../components/shared/Panel'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { PageStatus } from '../../components/shared/PageStatus'
import { Button } from '../../components/ui/button'
import { ModalDialog } from '../../components/ui/modal-dialog'

export default function SystemPage() {
  const { user } = useSession(),
    { t, i18n } = useTranslation(),
    [confirming, setConfirming] = useState(false),
    [notice, setNotice] = useState('')
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-system'],
    enabled: !!user,
    queryFn: ({ signal }) => operations.system(signal),
    staleTime: 0,
  })
  const cleanup = useOwnedMutation(user?.id, async (check) => {
    await operations.cleanup()
    check()
    setConfirming(false)
    setNotice('common.saved')
    await query.refetch()
  })
  const mail = useOwnedMutation(user?.id, async (check) => {
    await operations.testMail()
    check()
    setNotice('ops.mailSent')
  })
  const data = query.data,
    number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value)
  return (
    <AdminPage
      title={t('nav.systemInfo')}
      actions={
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.refresh')}
        </Button>
      }
    >
      {query.isPending || query.isError ? (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : data ? (
        <Panel className="ops-section">
          <dl className="grid gap-6 sm:grid-cols-2">
            {[
              ['version', data.version],
              ['commit', data.commit],
              ['buildTime', data.build_time],
              ['uptime', number(data.uptime_seconds)],
              ['database', t(data.database_ok ? 'ops.ok' : 'ops.unavailable')],
              ['redis', t(data.redis_ok ? 'ops.ok' : 'ops.unavailable')],
              [
                'storage',
                new Intl.NumberFormat(i18n.resolvedLanguage, {
                  style: 'unit',
                  unit: 'megabyte',
                  maximumFractionDigits: 2,
                }).format(data.image_bytes / 1048576),
              ],
            ].map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{t(`ops.${key}`)}</dt>
                <dd className="mt-2 break-all text-sm">{value || t('common.none')}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={cleanup.isPending}
              onClick={() => {
                cleanup.reset()
                setConfirming(true)
              }}
            >
              {t('ops.cleanup')}
            </Button>
            <Button variant="outline" disabled={mail.isPending} onClick={() => mail.mutate()}>
              {t('ops.testMail')}
            </Button>
          </div>
          <ApiNotice error={mail.error} />
          {notice ? (
            <p role="status" className="mt-4 text-xs text-primary">
              {t(notice)}
            </p>
          ) : null}
        </Panel>
      ) : null}
      <ModalDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('ops.confirm')}
        description={t('ops.cleanupConfirm')}
        busy={cleanup.isPending}
      >
        <ApiNotice error={cleanup.error} />
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={cleanup.isPending}
            onClick={() => setConfirming(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={cleanup.isPending}
            onClick={() => cleanup.mutate()}
          >
            {t('ops.confirm')}
          </Button>
        </div>
      </ModalDialog>
    </AdminPage>
  )
}
