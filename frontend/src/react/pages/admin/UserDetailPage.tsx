import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { accounts } from '../../../api/accounts'
import { operations } from '../../../api/operations'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { useRuntime } from '../../app/context'
import { useTime } from '../../features/accounts/time'
import { AdminPage } from '../../components/admin/AdminPage'
import { Panel } from '../../components/shared/Panel'
import { PageStatus } from '../../components/shared/PageStatus'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { DataTable } from '../../components/shared/DataTable'
import { CreditOverview } from '../../components/credits/CreditOverview'
import { CreditLedger } from '../../components/credits/CreditLedger'
import { RedemptionRecords } from '../../components/credits/RedemptionRecords'
import { Button } from '../../components/ui/button'
import { ModalDialog } from '../../components/ui/modal-dialog'

function UserDetail({ id }: { id: string }) {
  const { user: actor } = useSession(),
    runtime = useRuntime(),
    navigate = useNavigate(),
    { t } = useTranslation(),
    time = useTime(),
    [params, setParams] = useSearchParams()
  const query = useQuery({
    queryKey: ['user', actor?.id, 'admin-user', id],
    queryFn: ({ signal }) => accounts.detail(id, signal),
    enabled: !!actor,
  })
  const [revokeOpen, setRevokeOpen] = useState(false),
    [notice, setNotice] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const tab = params.get('tab') ?? 'profile'
  const revoke = useOwnedMutation(
    actor?.id,
    async (check) => {
      await operations.revokeAll(id)
      check()
      if (id === actor?.id) {
        runtime.clearSession()
        await navigate('/login', { replace: true })
      } else {
        setRevokeOpen(false)
        await query.refetch()
      }
    },
    { endsSession: true },
  )
  const copy = useOwnedMutation(actor?.id, async (check) => {
    await navigator.clipboard.writeText(id)
    check()
    setNotice('common.copied')
  })
  const data = query.data
  return (
    <AdminPage
      title={data?.user.nickname ?? t('admin.users.profileTab')}
      description={t('admin.users.detailDescription')}
      actions={
        <Link to="/admin/users" className="text-sm text-primary">
          {t('admin.users.title')}
        </Link>
      }
    >
      <div className="mb-5 flex flex-wrap gap-3">
        <Button
          ref={trigger}
          variant="outline"
          onClick={() => {
            revoke.reset()
            setRevokeOpen(true)
          }}
        >
          {t('ops.revokeAll')}
        </Button>
        <Button variant="outline" asChild>
          <Link to={'/admin/conversations?user_id=' + id}>{t('nav.adminChats')}</Link>
        </Button>
      </div>
      {query.isPending ? (
        <PageStatus />
      ) : query.isError ? (
        <PageStatus
          error={query.error}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : data ? (
        <>
          <nav
            className="mb-5 flex flex-wrap gap-2"
            aria-label={t('admin.users.detailDescription')}
          >
            {['profile', 'credits', 'records'].map((value) => (
              <Button
                key={value}
                variant={tab === value ? 'default' : 'outline'}
                size="sm"
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.set('tab', value)
                  setParams(next)
                }}
              >
                {t(
                  value === 'profile'
                    ? 'admin.users.profileTab'
                    : value === 'credits'
                      ? 'credits.ledger'
                      : 'credits.records',
                )}
              </Button>
            ))}
          </nav>
          {tab === 'credits' ? (
            <div className="space-y-6">
              <CreditOverview key={id} userId={id} />
              <CreditLedger admin userId={id} />
            </div>
          ) : tab === 'records' ? (
            <RedemptionRecords admin userId={id} />
          ) : (
            <div className="space-y-5">
              <Panel title={t('admin.users.profileTab')}>
                <dl className="grid gap-5 sm:grid-cols-2">
                  {[
                    ['auth.email', data.user.email],
                    ['admin.users.id', data.user.id],
                    ['admin.users.role', t(`admin.users.${data.user.role}`)],
                    ['admin.users.status', t(`admin.users.${data.user.status}`)],
                    ['admin.users.registered', time(data.user.created_at)],
                    [
                      'admin.users.lastLogin',
                      data.user.last_login_at ? time(data.user.last_login_at) : t('common.never'),
                    ],
                    ['admin.users.ip', data.user.last_login_ip || t('common.none')],
                    ['profile.timezone', data.user.timezone],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{t(label ?? '')}</dt>
                      <dd className="mt-2 break-all text-sm">
                        {value}
                        {label === 'admin.users.id' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-2 size-7"
                            aria-label={t('common.copyId')}
                            onClick={() => copy.mutate()}
                          >
                            <Copy size={13} />
                          </Button>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
                <ApiNotice error={copy.error} />
                {notice ? (
                  <p role="status" className="mt-4 text-xs text-primary">
                    {t(notice)}
                  </p>
                ) : null}
              </Panel>
              <Panel
                title={t('admin.users.sessions')}
                description={t('admin.users.sessionsDescription')}
              >
                {data.sessions.length ? (
                  <DataTable
                    rows={data.sessions}
                    columns={[
                      {
                        key: 'device',
                        label: t('admin.users.device'),
                        render: (row) => <span title={row.user_agent}>{row.device}</span>,
                      },
                      { key: 'ip', label: t('audit.ip'), render: (row) => row.ip },
                      {
                        key: 'created',
                        label: t('admin.users.sessionCreated'),
                        className: 'whitespace-nowrap',
                        render: (row) => time(row.created_at),
                      },
                      {
                        key: 'expires',
                        label: t('admin.users.expires'),
                        className: 'whitespace-nowrap',
                        render: (row) => time(row.expires_at),
                      },
                      {
                        key: 'status',
                        label: t('admin.users.status'),
                        render: (row) =>
                          t(
                            row.revoked_at
                              ? 'admin.users.revoked'
                              : new Date(row.expires_at).getTime() < Date.now()
                                ? 'admin.users.expired'
                                : 'admin.users.sessionActive',
                          ),
                      },
                    ]}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">{t('admin.users.noSessions')}</p>
                )}
              </Panel>
            </div>
          )}
        </>
      ) : null}
      <ModalDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t('ops.revokeAll')}
        description={t('ops.revokeConfirm')}
        busy={revoke.isPending}
        returnFocus={trigger}
      >
        <ApiNotice error={revoke.error} />
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={revoke.isPending}
            onClick={() => setRevokeOpen(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
            {t('ops.confirm')}
          </Button>
        </div>
      </ModalDialog>
    </AdminPage>
  )
}
export default function UserDetailPage() {
  const { id = '' } = useParams()
  return <UserDetail key={id} id={id} />
}
