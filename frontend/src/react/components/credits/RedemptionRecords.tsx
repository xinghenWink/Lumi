import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import { useSession } from '../../features/auth/hooks'
import { useCursorQuery } from '../../features/accounts/resources'
import { useTime } from '../../features/accounts/time'
import { ApiNotice } from '../shared/ApiNotice'
import { DataTable } from '../shared/DataTable'
import { CursorControls } from '../shared/CursorControls'
import { Button } from '../ui/button'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
export function RedemptionRecords({
  admin = false,
  userId,
  codeId,
}: {
  admin?: boolean
  userId?: string
  codeId?: string
}) {
  const { user } = useSession(),
    { t, i18n } = useTranslation(),
    time = useTime(),
    id = useId()
  const [filters, setFilters] = useState({ user: '', code: '' }),
    [applied, setApplied] = useState(filters)
  const query = useCursorQuery(
    ['user', user?.id, 'redemption-records', admin, userId, codeId, applied],
    (cursor, signal) => {
      const params = new URLSearchParams({ limit: '20', cursor })
      const owner = userId ?? applied.user.trim(),
        code = codeId ?? applied.code.trim()
      if (admin && owner) params.set('user_id', owner)
      if (code) params.set('code_id', code)
      return credits.records(params, admin, signal)
    },
    !!user,
  )
  return (
    <section className="min-w-0">
      <h2 className="mb-4 text-base font-semibold">{t('credits.records')}</h2>
      {admin ? (
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setApplied({ ...filters })
            query.reset()
          }}
        >
          {!userId ? (
            <Field id={id + '-user'} label={t('credits.userID')}>
              <Input
                id={id + '-user'}
                value={filters.user}
                maxLength={36}
                onChange={(event) => setFilters({ ...filters, user: event.target.value })}
              />
            </Field>
          ) : null}
          {!codeId ? (
            <Field id={id + '-code'} label={t('credits.codeID')}>
              <Input
                id={id + '-code'}
                value={filters.code}
                maxLength={36}
                onChange={(event) => setFilters({ ...filters, code: event.target.value })}
              />
            </Field>
          ) : null}
          <Button variant="outline" type="submit" disabled={query.isFetching}>
            {t('credits.filterRecords')}
          </Button>
        </form>
      ) : null}
      <ApiNotice error={query.error} />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {query.isPending ? (
          <p role="status" className="p-6 text-sm">
            {t('common.loading')}
          </p>
        ) : query.isError ? (
          <Button
            className="m-4"
            variant="outline"
            onClick={() => {
              void query.refetch()
            }}
          >
            {t('common.retry')}
          </Button>
        ) : !query.data?.items.length ? (
          <div className="p-6 text-center">
            <h3 className="text-sm">{t('credits.emptyRecords')}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{t('credits.emptyRecordsHint')}</p>
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
                key: 'tail',
                label: t('credits.tail'),
                render: (row) => <code>···· {row.code_tail}</code>,
              },
              {
                key: 'credits',
                label: t('credits.gained'),
                className: 'text-primary',
                render: (row) =>
                  '+' + new Intl.NumberFormat(i18n.resolvedLanguage).format(row.credits),
              },
              ...(admin
                ? [
                    {
                      key: 'ip',
                      label: t('audit.ip'),
                      render: (row: NonNullable<typeof query.data>['items'][number]) => row.ip,
                    },
                  ]
                : []),
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
