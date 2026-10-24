import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { accounts } from '../../../api/accounts'
import type { User } from '../../../api/contracts'
import { addDateRange } from '../../../features/accounts/utils'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useCursorQuery } from '../../features/accounts/resources'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { usePrivateDownload } from '../../features/files/download'
import { useTime } from '../../features/accounts/time'
import { AdminPage } from '../../components/admin/AdminPage'
import { UserDialog, type UserEditor } from '../../components/admin/UserDialog'
import { UserBatchDialog, type UserBatchAction } from '../../components/admin/UserBatchDialog'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { DataTable } from '../../components/shared/DataTable'
import { CursorControls } from '../../components/shared/CursorControls'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Field, selectClass } from '../../components/ui/field'

const emptyFilters = {
  search: '',
  role: '',
  status: '',
  sort: 'created_at',
  from: '',
  until: '',
  minBalance: '',
  maxBalance: '',
}
function StatusButton({ row, onSaved }: { row: User; onSaved(): void }) {
  const { user } = useSession(),
    { t } = useTranslation()
  const mutation = useOwnedMutation(user?.id, async (check) => {
    await accounts.update(row.id, { status: row.status === 'active' ? 'disabled' : 'active' })
    check()
    onSaved()
  })
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={row.id === user?.id || mutation.isPending}
        aria-label={
          t(row.status === 'active' ? 'admin.users.disable' : 'admin.users.enable') +
          ' ' +
          row.email
        }
        onClick={() => mutation.mutate()}
      >
        {t(row.status === 'active' ? 'admin.users.disable' : 'admin.users.enable')}
      </Button>
      <ApiNotice error={mutation.error} />
    </div>
  )
}
export default function UsersPage() {
  const runtime = useRuntime(),
    { user: actor } = useSession(),
    { t, i18n } = useTranslation(),
    time = useTime(),
    id = useId(),
    download = usePrivateDownload()
  const [filters, setFilters] = useState(emptyFilters),
    [applied, setApplied] = useState(emptyFilters)
  const [selected, setSelected] = useState<string[]>([]),
    [editor, setEditor] = useState<UserEditor | null>(null),
    [notice, setNotice] = useState('')
  const [batch, setBatch] = useState<{ action: UserBatchAction; ids: string[] } | null>(null)
  const prefix = ['user', actor?.id, 'admin-users'] as const
  const query = useCursorQuery(
    [...prefix, applied],
    (cursor, signal) => {
      const params = new URLSearchParams({
        search: applied.search.trim(),
        role: applied.role,
        status: applied.status,
        sort: applied.sort,
        limit: '20',
        cursor,
      })
      addDateRange(params, applied.from, applied.until)
      if (applied.minBalance !== '') params.set('min_balance', applied.minBalance)
      if (applied.maxBalance !== '') params.set('max_balance', applied.maxBalance)
      return accounts.list(params, signal)
    },
    !!actor,
  )
  const rows = query.data?.items ?? []
  const available = rows.filter((row) => row.id !== actor?.id).map((row) => row.id)
  const ids = selected.filter((id) => available.includes(id))
  const exporting = useOwnedMutation(actor?.id, () =>
    download(
      '/api/v1/admin/users/export?' +
        new URLSearchParams({
          search: applied.search.trim(),
          role: applied.role,
          status: applied.status,
        }),
      'lumi-users.csv',
      { responseType: 'blob' },
    ),
  )
  function refresh() {
    setSelected([])
    void runtime.queryClient.invalidateQueries({ queryKey: prefix })
  }
  function apply(values = filters) {
    setFilters(values)
    setApplied({ ...values })
    setSelected([])
    query.reset()
  }
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value)
  return (
    <AdminPage
      title={t('admin.users.title')}
      description={t('admin.users.description')}
      actions={
        <Button onClick={() => setEditor({ kind: 'create' })}>
          <Plus size={16} />
          {t('admin.users.new')}
        </Button>
      }
    >
      <form
        className="mb-5 space-y-4 rounded-2xl border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[minmax(240px,2fr)_1fr_1fr_1fr_auto]">
          <div className="col-span-2 xl:col-span-1">
            <Input
              type="search"
              maxLength={254}
              value={filters.search}
              aria-label={t('admin.users.searchPlaceholder')}
              placeholder={t('admin.users.searchPlaceholder')}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
          <select
            className={selectClass}
            aria-label={t('admin.users.role')}
            value={filters.role}
            onChange={(event) => apply({ ...filters, role: event.target.value })}
          >
            <option value="">{t('admin.users.allRoles')}</option>
            {['user', 'admin'].map((role) => (
              <option key={role} value={role}>
                {t(`admin.users.${role}`)}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            aria-label={t('admin.users.status')}
            value={filters.status}
            onChange={(event) => apply({ ...filters, status: event.target.value })}
          >
            <option value="">{t('admin.users.allStatuses')}</option>
            {['active', 'disabled'].map((status) => (
              <option key={status} value={status}>
                {t(`admin.users.${status}`)}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            aria-label={t('admin.users.newest')}
            value={filters.sort}
            onChange={(event) => apply({ ...filters, sort: event.target.value })}
          >
            <option value="created_at">{t('admin.users.newest')}</option>
            <option value="last_login_at">{t('admin.users.lastLoginSort')}</option>
            <option value="balance">{t('credits.balanceSort')}</option>
          </select>
          <Button type="submit" variant="outline">
            {t('common.search')}
          </Button>
        </div>
        <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-5">
          {(['minBalance', 'maxBalance'] as const).map((key) => (
            <Field
              key={key}
              id={id + '-' + key}
              label={t(key === 'minBalance' ? 'credits.minBalance' : 'credits.maxBalance')}
            >
              <Input
                id={id + '-' + key}
                type="number"
                min={0}
                max={2e12}
                step={1}
                value={filters[key]}
                onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
              />
            </Field>
          ))}
          {(['from', 'until'] as const).map((key) => (
            <Field
              key={key}
              id={id + '-' + key}
              label={t(key === 'from' ? 'common.from' : 'common.until')}
            >
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
        </div>
        <p className="text-[10px] text-muted-foreground">{t('common.filterUTC')}</p>
      </form>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xs text-muted-foreground">
          {t('ops.selected', { n: ids.length })}
        </span>
        {(['enable', 'disable', 'grant', 'delete'] as const).map((action) => (
          <Button
            key={action}
            variant="outline"
            size="sm"
            disabled={!ids.length}
            onClick={() => {
              setNotice('')
              setBatch({ action, ids: [...ids] })
            }}
          >
            {t(action === 'delete' ? 'ops.batchDelete' : `ops.${action}`)}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={exporting.isPending}
          onClick={() => exporting.mutate()}
        >
          {t('ops.exportUsers')}
        </Button>
      </div>
      <ApiNotice error={query.error || exporting.error} />
      {notice ? (
        <p role="status" className="mb-4 text-xs text-primary">
          {t(notice)}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
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
        ) : !rows.length ? (
          <div className="p-8 text-center">
            <h2 className="text-sm">{t('admin.users.emptyTitle')}</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('admin.users.emptyDescription')}
            </p>
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={[
              {
                key: 'select',
                label: (
                  <input
                    type="checkbox"
                    aria-label={t('ops.selectPage')}
                    disabled={!available.length}
                    checked={!!available.length && available.every((id) => ids.includes(id))}
                    onChange={(event) => setSelected(event.target.checked ? available : [])}
                  />
                ),
                render: (row) => (
                  <input
                    type="checkbox"
                    aria-label={t('ops.select') + ' ' + row.email}
                    disabled={row.id === actor?.id}
                    checked={ids.includes(row.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id),
                      )
                    }
                  />
                ),
              },
              {
                key: 'identity',
                label: t('admin.users.identity'),
                render: (row) => (
                  <Link className="identity-link block min-w-44" to={'/admin/users/' + row.id}>
                    <strong className="block text-foreground hover:text-primary">
                      {row.nickname}
                    </strong>
                    <span className="block text-muted-foreground">{row.email}</span>
                    <code className="user-id block text-[10px] text-muted-foreground">
                      {row.id}
                    </code>
                  </Link>
                ),
              },
              {
                key: 'role',
                label: t('admin.users.role'),
                className: 'whitespace-nowrap',
                render: (row) => t(`admin.users.${row.role}`),
              },
              {
                key: 'status',
                label: t('admin.users.status'),
                className: 'whitespace-nowrap',
                render: (row) => (
                  <span className={row.status === 'active' ? 'text-primary' : 'text-destructive'}>
                    {t(`admin.users.${row.status}`)}
                  </span>
                ),
              },
              {
                key: 'credits',
                label: t('credits.total'),
                className: 'numeric whitespace-nowrap',
                render: (row) => (
                  <>
                    <Link
                      to={'/admin/users/' + row.id + '?tab=credits'}
                      aria-label={t('credits.adjust') + ' ' + row.email}
                    >
                      <strong className="text-primary">
                        {row.total_credits === undefined
                          ? t('common.none')
                          : number(row.total_credits)}
                      </strong>
                    </Link>
                    {row.total_credits === undefined ? null : (
                      <small className="block text-muted-foreground">
                        {t('credits.split', {
                          daily: row.daily_balance,
                          permanent: row.permanent_balance,
                        })}
                      </small>
                    )}
                  </>
                ),
              },
              {
                key: 'registered',
                label: t('admin.users.registered'),
                className: 'whitespace-nowrap',
                render: (row) => time(row.created_at),
              },
              {
                key: 'login',
                label: t('admin.users.lastLogin'),
                className: 'whitespace-nowrap',
                render: (row) => (row.last_login_at ? time(row.last_login_at) : t('common.never')),
              },
              {
                key: 'actions',
                label: t('common.actions'),
                render: (row) => (
                  <div className="flex items-start gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('admin.users.edit') + ' ' + row.email}
                      onClick={() => {
                        setNotice('')
                        setEditor({ kind: 'edit', user: row })
                      }}
                    >
                      <Pencil size={15} />
                    </Button>
                    <StatusButton
                      row={row}
                      onSaved={() => {
                        setNotice('admin.users.statusSuccess')
                        refresh()
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      disabled={row.id === actor?.id}
                      aria-label={t('admin.users.delete') + ' ' + row.email}
                      onClick={() => {
                        setNotice('')
                        setEditor({ kind: 'delete', user: row })
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
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
            onPrevious={() => {
              setSelected([])
              query.previous()
            }}
            onNext={() => {
              setSelected([])
              query.next()
            }}
          />
        ) : null}
      </div>
      {editor ? (
        <UserDialog
          key={editor.kind + (editor.kind === 'create' ? '' : editor.user.id)}
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null)
            setNotice(message)
            refresh()
          }}
        />
      ) : null}
      {batch ? (
        <UserBatchDialog
          ids={batch.ids}
          action={batch.action}
          onClose={() => setBatch(null)}
          onSaved={() => {
            setBatch(null)
            setNotice('ops.batchDone')
            refresh()
          }}
        />
      ) : null}
    </AdminPage>
  )
}
