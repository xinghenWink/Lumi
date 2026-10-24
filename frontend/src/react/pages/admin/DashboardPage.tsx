import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { operations, type Day } from '../../../api/operations'
import { useSession } from '../../features/auth/hooks'
import { AdminPage } from '../../components/admin/AdminPage'
import { Panel } from '../../components/shared/Panel'
import { PageStatus } from '../../components/shared/PageStatus'
import { DataTable } from '../../components/shared/DataTable'
import { Button } from '../../components/ui/button'

const dailyColumns = [
  ['new_users', 'newUsers'],
  ['active_users', 'activeUsers'],
  ['chat_messages', 'chats'],
  ['image_success', 'success'],
  ['image_failed', 'failed'],
  ['credits_granted', 'granted'],
  ['credits_spent', 'spent'],
  ['signup_credits', 'signupCredits'],
  ['daily_credits', 'dailyCredits'],
  ['redeem_credits', 'redeemCredits'],
  ['admin_credits', 'adminCredits'],
] as const
export default function DashboardPage() {
  const { user } = useSession(),
    { t, i18n } = useTranslation(),
    [days, setDays] = useState(7)
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-dashboard', days],
    enabled: !!user,
    queryFn: ({ signal }) => operations.dashboard(days, signal),
    staleTime: 0,
  })
  const data = query.data,
    maximum = Math.max(
      1,
      ...(data?.days.map((day) => day.chat_messages + day.image_success) ?? []),
    ),
    number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value)
  return (
    <AdminPage
      title={t('nav.dashboard')}
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
      <div className="mb-5 flex flex-wrap gap-2">
        {[1, 7, 30].map((value) => (
          <Button
            key={value}
            variant={days === value ? 'default' : 'outline'}
            aria-pressed={days === value}
            size="sm"
            onClick={() => setDays(value)}
          >
            {value === 1 ? t('ops.today') : t('ops.days', { n: value })}
          </Button>
        ))}
      </div>
      {query.isPending || query.isError ? (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : data ? (
        <div className="space-y-5">
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              ['users', data.users],
              ['activeStreams', data.active_streams],
              ['creditChanges', data.credit_changes],
            ].map(([key, value]) => (
              <div key={String(key)} className="rounded-2xl border border-border bg-card p-5">
                <dt className="text-xs text-muted-foreground">{t(`ops.${key}`)}</dt>
                <dd className="mt-3 text-3xl font-semibold tracking-tight">
                  {number(Number(value))}
                </dd>
              </div>
            ))}
          </dl>
          <Panel title={t('ops.trend')}>
            <div role="img" aria-label={t('ops.trend')} className="space-y-3">
              {data.days.map((day) => (
                <div
                  key={day.date}
                  className="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-3 text-xs"
                >
                  <span className="text-muted-foreground">{day.date.slice(5)}</span>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: (100 * (day.chat_messages + day.image_success)) / maximum + '%',
                      }}
                    />
                  </div>
                  <span className="text-right tabular-nums">
                    {number(day.chat_messages + day.image_success)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {t('ops.chats')} + {t('ops.success')}
            </p>
          </Panel>
          <Panel>
            <DataTable<Day & { id: string }>
              rows={data.days.map((day) => ({ ...day, id: day.date }))}
              columns={[
                {
                  key: 'date',
                  label: t('ops.date'),
                  className: 'whitespace-nowrap',
                  render: (row) => row.date,
                },
                ...dailyColumns.map(([key, label]) => ({
                  key,
                  label: t(`ops.${label}`),
                  render: (row: (typeof data.days)[number]) => number(row[key]),
                })),
              ]}
            />
          </Panel>
          <Panel title={t('ops.upstreams')}>
            {data.upstreams.length ? (
              <DataTable
                rows={data.upstreams}
                columns={[
                  {
                    key: 'id',
                    label: t('nav.upstreams'),
                    render: (row) => <code className="break-all text-[10px]">{row.id}</code>,
                  },
                  { key: 'calls', label: t('ops.calls'), render: (row) => number(row.calls) },
                  {
                    key: 'success',
                    label: t('ops.successRate'),
                    render: (row) =>
                      new Intl.NumberFormat(i18n.resolvedLanguage, {
                        style: 'percent',
                        maximumFractionDigits: 1,
                      }).format(row.successes / Math.max(1, row.calls)),
                  },
                  {
                    key: 'latency',
                    label: t('ops.latency'),
                    render: (row) => number(row.latency_ms),
                  },
                ]}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t('common.empty')}</p>
            )}
          </Panel>
        </div>
      ) : null}
    </AdminPage>
  )
}
