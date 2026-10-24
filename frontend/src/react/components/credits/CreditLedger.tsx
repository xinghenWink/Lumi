import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import { addDateRange } from '../../../features/accounts/utils'
import { useSession } from '../../features/auth/hooks'
import { useCursorQuery } from '../../features/accounts/resources'
import { useTime } from '../../features/accounts/time'
import { usePrivateDownload } from '../../features/files/download'
import { CursorControls } from '../shared/CursorControls'
import { DataTable } from '../shared/DataTable'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Field, selectClass } from '../ui/field'
const types = [
  'signup_bonus',
  'daily_grant',
  'daily_expire',
  'redeem',
  'admin_adjust',
  'image_charge',
  'image_refund',
]
export function CreditLedger({ admin = false, userId }: { admin?: boolean; userId?: string }) {
  const { user } = useSession(),
    { t, i18n } = useTranslation(),
    time = useTime(),
    id = useId(),
    download = usePrivateDownload()
  const [filters, setFilters] = useState({ type: '', from: '', until: '', userId: '' }),
    [applied, setApplied] = useState(filters)
  const params = (cursor = '') => {
    const query = new URLSearchParams({ limit: '20', cursor, type: applied.type })
    const owner = userId ?? applied.userId.trim()
    if (admin && owner) query.set('user_id', owner)
    addDateRange(query, applied.from, applied.until)
    return query
  }
  const query = useCursorQuery(
    ['user', user?.id, 'credit-ledger', admin, userId, applied],
    (cursor, signal) => credits.ledger(params(cursor), admin, signal),
    !!user,
  )
  const exporting = useMutation({
    mutationFn: () =>
      download('/api/v1/admin/credit-ledger/export?' + params(), 'lumi-credit-ledger.csv'),
  })
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value)
  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('credits.ledger')}</h2>
        {admin ? (
          <Button
            variant="outline"
            size="sm"
            disabled={exporting.isPending}
            onClick={() => exporting.mutate()}
          >
            {t('credits.export')}
          </Button>
        ) : null}
      </div>
      <form
        className="mb-4 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({ ...filters })
          query.reset()
        }}
      >
        {admin && !userId ? (
          <Field id={id + '-user'} label={t('credits.userID')}>
            <Input
              id={id + '-user'}
              maxLength={36}
              value={filters.userId}
              onChange={(event) => setFilters({ ...filters, userId: event.target.value })}
            />
          </Field>
        ) : null}
        <Field id={id + '-type'} label={t('credits.type')}>
          <select
            id={id + '-type'}
            className={selectClass}
            value={filters.type}
            onChange={(event) => setFilters({ ...filters, type: event.target.value })}
          >
            <option value="">{t('credits.allTypes')}</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {t(`credits.types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-from'} label={t('common.from')}>
          <Input
            id={id + '-from'}
            type="date"
            value={filters.from}
            max={filters.until || undefined}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </Field>
        <Field id={id + '-until'} label={t('common.until')}>
          <Input
            id={id + '-until'}
            type="date"
            value={filters.until}
            min={filters.from || undefined}
            onChange={(event) => setFilters({ ...filters, until: event.target.value })}
          />
        </Field>
        <Button type="submit" variant="outline" disabled={query.isFetching}>
          {t('common.search')}
        </Button>
        <span className="text-[10px] text-muted-foreground">{t('common.filterUTC')}</span>
      </form>
      <ApiNotice error={query.error || exporting.error} />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {query.isPending ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : query.isError ? (
          <Button
            variant="outline"
            className="m-4"
            onClick={() => {
              void query.refetch()
            }}
          >
            {t('common.retry')}
          </Button>
        ) : !query.data?.items.length ? (
          <div className="p-6 text-center">
            <h3 className="text-sm">{t('credits.emptyLedger')}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{t('credits.emptyLedgerHint')}</p>
          </div>
        ) : (
          <DataTable
            rows={query.data.items}
            columns={[
              {
                key: 'time',
                label: t('credits.time'),
                className: 'whitespace-nowrap',
                render: (row) => time(row.created_at),
              },
              ...(admin && !userId
                ? [
                    {
                      key: 'user',
                      label: t('credits.userID'),
                      render: (row: NonNullable<typeof query.data>['items'][number]) => (
                        <code>{row.user_id}</code>
                      ),
                    },
                  ]
                : []),
              {
                key: 'type',
                label: t('credits.type'),
                className: 'whitespace-nowrap',
                render: (row) => t(`credits.types.${row.type}`),
              },
              {
                key: 'bucket',
                label: t('credits.bucket'),
                className: 'whitespace-nowrap',
                render: (row) => t('credits.' + row.bucket),
              },
              {
                key: 'delta',
                label: t('credits.delta'),
                className: 'whitespace-nowrap font-medium',
                render: (row) => (
                  <span className={row.delta > 0 ? 'text-primary' : 'text-destructive'}>
                    {row.delta > 0 ? '+' : ''}
                    {number(row.delta)}
                  </span>
                ),
              },
              {
                key: 'balance',
                label: t('credits.balanceAfter'),
                className: 'whitespace-nowrap',
                render: (row) => (
                  <>
                    <strong>{number(row.total_after)}</strong>
                    <small className="block text-muted-foreground">
                      {t('credits.bucketAfter', { amount: number(row.bucket_balance_after) })}
                    </small>
                  </>
                ),
              },
              {
                key: 'note',
                label: t('credits.note'),
                className: 'min-w-40',
                render: (row) => (
                  <>
                    {row.note || t('common.none')}
                    {row.ref_id ? (
                      <code
                        className="block break-all text-[10px] text-muted-foreground"
                        title={t('credits.reference')}
                      >
                        {row.ref_id}
                      </code>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        )}
        {query.data ? (
          <CursorControls
            page={query.page}
            nextCursor={query.data.next_cursor}
            loading={query.isFetching}
            onPrevious={query.previous}
            onNext={query.next}
          />
        ) : null}
      </div>
    </section>
  )
}
