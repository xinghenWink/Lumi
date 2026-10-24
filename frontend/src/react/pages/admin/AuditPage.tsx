import { auditActions, auditTargets } from '../../../api/audit-options'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { accounts } from '../../../api/accounts'
import type { AuditRecord } from '../../../api/contracts'
import { addDateRange } from '../../../features/accounts/utils'
import { useSession } from '../../features/auth/hooks'
import { useTime } from '../../features/accounts/time'
import { useCursorQuery } from '../../features/accounts/resources'
import { AdminPage } from '../../components/admin/AdminPage'
import { PageStatus } from '../../components/shared/PageStatus'
import { CursorControls } from '../../components/shared/CursorControls'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Field, selectClass } from '../../components/ui/field'

const emptyFilters = { action: '', actor: '', targetType: '', targetId: '', from: '', until: '' }
function AuditEntry({ row }: { row: AuditRecord }) {
  const { t, i18n } = useTranslation(),
    time = useTime(),
    [open, setOpen] = useState(false)
  const action = i18n.exists('audit.actions.' + row.action)
    ? t(`audit.actions.${row.action}`)
    : t('audit.otherAction', { action: row.action })
  const target = i18n.exists('audit.types.' + row.target_type)
    ? t(`audit.types.${row.target_type}`)
    : row.target_type
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <header className="mb-4 flex flex-wrap justify-between gap-3">
        <strong className="text-sm">{action}</strong>
        <time className="text-xs text-muted-foreground">{time(row.created_at)}</time>
      </header>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t('audit.actor')}</dt>
          <dd className="mt-2 break-all text-xs">
            {row.actor_id ? (
              <Link to={'/admin/users/' + row.actor_id} className="text-primary">
                {row.actor_id}
              </Link>
            ) : (
              t('audit.system')
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('audit.target')}</dt>
          <dd className="mt-2 break-all text-xs">
            {target}
            {row.target_id ? <code className="mt-1 block text-[10px]">{row.target_id}</code> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('audit.ip')}</dt>
          <dd className="mt-2 break-all text-xs">{row.ip}</dd>
        </div>
      </dl>
      <details
        className="mt-5 border-t border-border pt-3"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs text-primary">{t('audit.changes')}</summary>
        {open ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              ['before', row.before],
              ['after', row.after],
            ].map(([key, value]) => (
              <div key={String(key)} className="min-w-0">
                <h2 className="mb-2 text-xs text-muted-foreground">{t(`audit.${key}`)}</h2>
                <pre className="max-h-80 overflow-auto rounded-xl bg-muted p-3 text-[11px] break-all whitespace-pre-wrap">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </details>
    </article>
  )
}
export default function AuditPage() {
  const { user } = useSession(),
    { t, i18n } = useTranslation(),
    id = useId(),
    [filters, setFilters] = useState(emptyFilters),
    [applied, setApplied] = useState(emptyFilters)
  const query = useCursorQuery(
    ['user', user?.id, 'admin-audit', applied],
    (cursor, signal) => {
      const params = new URLSearchParams({
        action: applied.action,
        actor_id: applied.actor.trim(),
        target_type: applied.targetType,
        target_id: applied.targetId.trim(),
        cursor,
        limit: '20',
      })
      addDateRange(params, applied.from, applied.until)
      return accounts.audit(params, signal)
    },
    !!user,
  )
  function apply(values = filters) {
    setFilters(values)
    setApplied({ ...values })
    query.reset()
    if (JSON.stringify(values) === JSON.stringify(applied)) void query.refetch()
  }
  return (
    <AdminPage title={t('audit.title')} description={t('audit.description')}>
      <form
        className="mb-5 grid grid-cols-2 items-end gap-3 rounded-2xl border border-border bg-card p-4 xl:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <Field id={id + '-action'} label={t('audit.action')}>
          <select
            id={id + '-action'}
            className={selectClass}
            value={filters.action}
            onChange={(event) => setFilters({ ...filters, action: event.target.value })}
          >
            <option value="">{t('audit.allActions')}</option>
            {auditActions.map((action) => (
              <option key={action} value={action}>
                {i18n.exists('audit.actions.' + action)
                  ? t(`audit.actions.${action}`)
                  : t('audit.otherAction', { action })}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-actor'} label={t('audit.actor')}>
          <Input
            id={id + '-actor'}
            value={filters.actor}
            maxLength={36}
            placeholder={t('audit.actorPlaceholder')}
            onChange={(event) => setFilters({ ...filters, actor: event.target.value })}
          />
        </Field>
        <Field id={id + '-type'} label={t('audit.targetType')}>
          <select
            id={id + '-type'}
            className={selectClass}
            value={filters.targetType}
            onChange={(event) => setFilters({ ...filters, targetType: event.target.value })}
          >
            <option value="">{t('audit.allTargets')}</option>
            {auditTargets.map((type) => (
              <option key={type} value={type}>
                {i18n.exists('audit.types.' + type) ? t(`audit.types.${type}`) : type}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-target'} label={t('audit.targetId')}>
          <Input
            id={id + '-target'}
            value={filters.targetId}
            maxLength={36}
            onChange={(event) => setFilters({ ...filters, targetId: event.target.value })}
          />
        </Field>
        {(['from', 'until'] as const).map((key) => (
          <Field key={key} id={id + '-' + key} label={t(`common.${key}`)}>
            <Input
              id={id + '-' + key}
              type="date"
              value={filters[key]}
              onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
            />
          </Field>
        ))}
        <Button type="button" variant="ghost" onClick={() => apply(emptyFilters)}>
          {t('common.reset')}
        </Button>
        <Button type="submit" variant="outline" disabled={query.isFetching}>
          {t('common.search')}
        </Button>
        <p className="col-span-2 text-[10px] text-muted-foreground xl:col-span-4">
          {t('common.filterUTC')}
        </p>
      </form>
      {query.isPending || query.isError ? (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : (
        <div className="space-y-4">
          {query.data?.items.length ? (
            query.data.items.map((row) => <AuditEntry key={row.id} row={row} />)
          ) : (
            <div className="py-8 text-center">
              <h2 className="text-sm">{t('audit.emptyTitle')}</h2>
              <p className="mt-2 text-xs text-muted-foreground">{t('audit.emptyDescription')}</p>
            </div>
          )}
          <CursorControls
            page={query.page}
            nextCursor={query.data?.next_cursor ?? ''}
            loading={query.isFetching}
            onPrevious={query.previous}
            onNext={query.next}
          />
        </div>
      )}
    </AdminPage>
  )
}
