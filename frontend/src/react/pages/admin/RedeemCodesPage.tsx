import { useId, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Copy, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import type { RedeemCode } from '../../../api/credit-contracts'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useCursorQuery } from '../../features/accounts/resources'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { usePrivateDownload } from '../../features/files/download'
import { useTime } from '../../features/accounts/time'
import { RedeemBatchDialog } from '../../components/admin/RedeemBatchDialog'
import { AdminPage } from '../../components/admin/AdminPage'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { DataTable } from '../../components/shared/DataTable'
import { CursorControls } from '../../components/shared/CursorControls'
import { RedemptionRecords } from '../../components/credits/RedemptionRecords'
import { Button } from '../../components/ui/button'
import { Field, selectClass } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { ModalDialog } from '../../components/ui/modal-dialog'

function CodeActions({
  row,
  onChanged,
  onRecords,
  onCopied,
}: {
  row: RedeemCode
  onChanged(): void
  onRecords(): void
  onCopied(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation()
  const toggle = useOwnedMutation(user?.id, async (check) => {
    await credits.toggleCodes([row.id], !row.enabled)
    check()
    onChanged()
  })
  const copy = useOwnedMutation(user?.id, async (check) => {
    await navigator.clipboard.writeText(row.code)
    check()
    onCopied()
  })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t('credits.clipboard') + ' ' + row.tail}
        onClick={() => copy.mutate()}
      >
        <Copy size={14} />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
      >
        {t(row.enabled ? 'credits.disable' : 'credits.enable')}
      </Button>
      <Button variant="ghost" size="sm" onClick={onRecords}>
        {t('credits.viewRecords')}
      </Button>
      <ApiNotice error={toggle.error || copy.error} />
    </div>
  )
}
export default function RedeemCodesPage() {
  const runtime = useRuntime(),
    { user } = useSession(),
    { t, i18n } = useTranslation(),
    time = useTime(),
    id = useId(),
    download = usePrivateDownload()
  const [filters, setFilters] = useState({ batch: '', status: '', search: '' }),
    [applied, setApplied] = useState(filters)
  const [selected, setSelected] = useState<string[]>([]),
    [tab, setTab] = useState('codes'),
    [recordCode, setRecordCode] = useState('')
  const [creating, setCreating] = useState(false),
    [deleting, setDeleting] = useState(false),
    [notice, setNotice] = useState<{ key: string; count?: number } | null>(null)
  const prefix = ['user', user?.id, 'admin-redeem-codes'] as const
  const params = (cursor = '') =>
    new URLSearchParams({
      batch_id: applied.batch,
      status: applied.status,
      search: applied.search.trim(),
      limit: '20',
      cursor,
    })
  const query = useCursorQuery(
    [...prefix, applied],
    (cursor, signal) => credits.codes(params(cursor), signal),
    !!user,
  )
  const batches = useInfiniteQuery({
    queryKey: ['user', user?.id, 'admin-redeem-batches'],
    enabled: !!user,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      credits.batches(new URLSearchParams({ limit: '100', cursor: pageParam }), signal),
    getNextPageParam: (page) => page.next_cursor || undefined,
  })
  const rows = query.data?.items ?? [],
    ids = selected.filter((id) => rows.some((row) => row.id === id))
  const enabled = useRef(true)
  function refresh() {
    setSelected([])
    void runtime.queryClient.invalidateQueries({ queryKey: prefix })
  }
  const toggle = useOwnedMutation(user?.id, async (check) => {
    const nextEnabled = enabled.current
    await credits.toggleCodes(ids, nextEnabled)
    check()
    setNotice({ key: 'credits.codesUpdated' })
    refresh()
  })
  const remove = useOwnedMutation(user?.id, async (check) => {
    await credits.deleteCodes(ids)
    check()
    setDeleting(false)
    setNotice({ key: 'credits.codesDeleted' })
    query.reset()
    refresh()
  })
  const exporting = useOwnedMutation(user?.id, () =>
    download('/api/v1/admin/redeem-codes/export?' + params(), 'lumi-redeem-codes.csv', {
      responseType: 'blob',
    }),
  )
  function search(values = filters) {
    setFilters(values)
    setApplied({ ...values })
    setSelected([])
    query.reset()
  }
  return (
    <AdminPage
      title={t('credits.codesTitle')}
      description={t('credits.codesDescription')}
      actions={
        <Button
          onClick={() => {
            setNotice(null)
            setCreating(true)
          }}
        >
          <Plus size={16} />
          {t('credits.newBatch')}
        </Button>
      }
    >
      <nav className="mb-5 flex gap-2" aria-label={t('credits.codesTitle')}>
        {['codes', 'records'].map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tab === value ? 'default' : 'outline'}
            aria-current={tab === value ? 'page' : undefined}
            onClick={() => setTab(value)}
          >
            {t(value === 'codes' ? 'credits.codesTitle' : 'credits.records')}
          </Button>
        ))}
      </nav>
      {notice ? (
        <p role="status" className="mb-4 text-xs text-primary">
          {t(notice.key, { count: notice.count })}
        </p>
      ) : null}
      <ApiNotice error={batches.error || toggle.error || exporting.error} />
      {tab === 'records' ? (
        <RedemptionRecords key={recordCode} admin {...(recordCode ? { codeId: recordCode } : {})} />
      ) : (
        <>
          <form
            className="mb-4 grid grid-cols-2 items-end gap-3 xl:grid-cols-[1fr_1fr_2fr_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              search()
            }}
          >
            <Field id={id + '-batch'} label={t('credits.batch')}>
              <select
                id={id + '-batch'}
                value={filters.batch}
                className={selectClass}
                onChange={(event) => setFilters({ ...filters, batch: event.target.value })}
              >
                <option value="">{t('credits.allBatches')}</option>
                {batches.data?.pages
                  .flatMap((page) => page.items)
                  .map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.name} · {batch.quantity}
                    </option>
                  ))}
              </select>
            </Field>
            <Field id={id + '-status'} label={t('credits.status')}>
              <select
                id={id + '-status'}
                value={filters.status}
                className={selectClass}
                onChange={(event) => setFilters({ ...filters, status: event.target.value })}
              >
                <option value="">{t('credits.allStatuses')}</option>
                {['unused', 'used', 'expired', 'disabled'].map((status) => (
                  <option key={status} value={status}>
                    {t(`credits.${status}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={id + '-search'} label={t('credits.exactCodeSearch')}>
              <Input
                id={id + '-search'}
                maxLength={80}
                value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={query.isFetching}>
              {t('common.search')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={exporting.isPending}
              onClick={() => exporting.mutate()}
            >
              {t('credits.export')}
            </Button>
          </form>
          {batches.hasNextPage ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={batches.isFetchingNextPage}
              onClick={() => {
                void batches.fetchNextPage()
              }}
            >
              {t('credits.moreBatches')}
            </Button>
          ) : null}
          {ids.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t('credits.selected', { count: ids.length })}
              </span>
              {[true, false].map((value) => (
                <Button
                  key={String(value)}
                  aria-label={t(value ? 'ops.enable' : 'ops.disable')}
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => {
                    enabled.current = value
                    toggle.mutate()
                  }}
                >
                  {t(value ? 'credits.enable' : 'credits.disable')}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={() => {
                  remove.reset()
                  setDeleting(true)
                }}
              >
                {t('credits.delete')}
              </Button>
            </div>
          ) : null}
          <ApiNotice error={query.error} />
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {query.isPending ? (
              <p role="status" className="p-6 text-sm">
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
            ) : !rows.length ? (
              <div className="p-8 text-center">
                <h2 className="text-sm">{t('credits.noCodes')}</h2>
                <p className="mt-2 text-xs text-muted-foreground">{t('credits.noCodesHint')}</p>
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
                        aria-label={t('credits.selectAll')}
                        checked={!!rows.length && rows.every((row) => ids.includes(row.id))}
                        onChange={(event) =>
                          setSelected(event.target.checked ? rows.map((row) => row.id) : [])
                        }
                      />
                    ),
                    render: (row) => (
                      <input
                        type="checkbox"
                        aria-label={t('credits.select') + ' ' + row.tail}
                        checked={ids.includes(row.id)}
                        disabled={toggle.isPending || remove.isPending}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...ids, row.id]
                              : ids.filter((id) => id !== row.id),
                          )
                        }
                      />
                    ),
                  },
                  {
                    key: 'code',
                    label: t('credits.code'),
                    render: (row) => <code className="whitespace-nowrap">{row.code}</code>,
                  },
                  {
                    key: 'credits',
                    label: t('credits.creditsPerCode'),
                    className: 'numeric whitespace-nowrap',
                    render: (row) =>
                      new Intl.NumberFormat(i18n.resolvedLanguage).format(row.credits),
                  },
                  {
                    key: 'used',
                    label: t('credits.usedCount'),
                    className: 'whitespace-nowrap',
                    render: (row) => row.used_count + ' / ' + row.max_uses,
                  },
                  {
                    key: 'status',
                    label: t('credits.status'),
                    className: 'whitespace-nowrap',
                    render: (row) => t(`credits.${row.status}`),
                  },
                  {
                    key: 'expires',
                    label: t('admin.users.expires'),
                    className: 'whitespace-nowrap',
                    render: (row) =>
                      row.expires_at ? time(row.expires_at) : t('credits.neverExpires'),
                  },
                  {
                    key: 'actions',
                    label: t('common.actions'),
                    render: (row) => (
                      <CodeActions
                        row={row}
                        onChanged={() => {
                          setNotice({ key: 'credits.codesUpdated' })
                          refresh()
                        }}
                        onRecords={() => {
                          setRecordCode(row.id)
                          setTab('records')
                        }}
                        onCopied={() => setNotice({ key: 'common.copied' })}
                      />
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
        </>
      )}
      {creating ? (
        <RedeemBatchDialog
          onClose={() => setCreating(false)}
          onSaved={(batch) => {
            setCreating(false)
            setNotice({ key: 'credits.batchCreated', count: batch.quantity })
            search({ ...filters, batch: batch.id })
            void batches.refetch()
          }}
        />
      ) : null}
      <ModalDialog
        open={deleting}
        onOpenChange={setDeleting}
        busy={remove.isPending}
        title={t('credits.deleteTitle')}
        description={t('credits.deleteDescription', { count: ids.length })}
      >
        <ApiNotice error={remove.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending || !ids.length}
            onClick={() => remove.mutate()}
          >
            {t('credits.deleteAction')}
          </Button>
        </div>
      </ModalDialog>
    </AdminPage>
  )
}
