import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { catalog } from '../../../api/catalog'
import type { ConnectionTest, Upstream } from '../../../api/catalog-contracts'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useCursorQuery } from '../../features/accounts/resources'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { invalidateCatalog, upstreamInput } from '../../features/admin/catalog'
import { AdminPage } from '../../components/admin/AdminPage'
import { UpstreamDialog } from '../../components/admin/UpstreamDialog'
import { ImportModelsDialog } from '../../components/admin/ImportModelsDialog'
import { DataTable } from '../../components/shared/DataTable'
import { CursorControls } from '../../components/shared/CursorControls'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { PageStatus } from '../../components/shared/PageStatus'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { selectClass } from '../../components/ui/field'
import { ModalDialog } from '../../components/ui/modal-dialog'

function ChannelActions({
  row,
  onEdit,
  onImport,
  onDelete,
  onChanged,
}: {
  row: Upstream
  onEdit(): void
  onImport(): void
  onDelete(): void
  onChanged(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation()
  const [result, setResult] = useState<(ConnectionTest & { version: number }) | null>(null)
  const toggle = useOwnedMutation(user?.id, async (check) => {
    await catalog.saveChannel({ ...upstreamInput(row), enabled: !row.enabled }, row.id)
    check()
    setResult(null)
    onChanged()
  })
  const testing = useOwnedMutation(user?.id, async (check) => {
    const response = await catalog.test(row.id)
    check()
    setResult({ ...response, version: row.version })
  })
  return (
    <div className="min-w-64">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('catalog.editChannel') + ' ' + row.name}
          onClick={onEdit}
        >
          <Pencil size={15} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {t(row.enabled ? 'credits.disable' : 'credits.enable')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={testing.isPending}
          onClick={() => testing.mutate()}
        >
          {t(testing.isPending ? 'catalog.testing' : 'catalog.test')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onImport}>
          {t('catalog.sync')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          aria-label={t('catalog.deleteChannel') + ' ' + row.name}
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </Button>
      </div>
      <ApiNotice error={toggle.error || testing.error} />
      {result?.version === row.version ? (
        <div className="mt-2">
          <p
            className={result.success ? 'text-primary' : 'text-destructive'}
            role={result.success ? 'status' : 'alert'}
          >
            {t(result.success ? 'catalog.connectionOK' : 'catalog.connectionFailed', {
              count: result.model_count,
              ms: result.latency_ms,
            })}
          </p>
          {result.error_code ? <ApiNotice error={new ApiError(result.error_code)} /> : null}
        </div>
      ) : null}
    </div>
  )
}
export default function UpstreamsPage() {
  const runtime = useRuntime(),
    { user } = useSession(),
    { t, i18n } = useTranslation()
  const [filters, setFilters] = useState({ search: '', state: '' }),
    [applied, setApplied] = useState(filters)
  const [editor, setEditor] = useState<{ row: Upstream | null } | null>(null),
    [importing, setImporting] = useState<Upstream | null>(null),
    [deleting, setDeleting] = useState<Upstream | null>(null),
    [notice, setNotice] = useState<{ key: string; count?: number } | null>(null)
  const query = useCursorQuery(
    ['user', user?.id, 'admin-upstreams', applied],
    (cursor, signal) =>
      catalog.channels(new URLSearchParams({ ...applied, cursor, limit: '20' }), signal),
    !!user,
  )
  const remove = useOwnedMutation(user?.id, async (check) => {
    if (!deleting) return
    await catalog.deleteChannel(deleting.id)
    check()
    setDeleting(null)
    setNotice({ key: 'catalog.channelDeleted' })
    query.reset()
    invalidateCatalog(runtime, user?.id)
  })
  function changed() {
    setNotice({ key: 'catalog.channelSaved' })
    invalidateCatalog(runtime, user?.id)
  }
  return (
    <AdminPage
      title={t('catalog.channelsTitle')}
      description={t('catalog.channelsDescription')}
      actions={
        <Button onClick={() => setEditor({ row: null })}>
          <Plus size={16} />
          {t('catalog.newChannel')}
        </Button>
      }
    >
      <form
        className="mb-5 flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({ ...filters })
          query.reset()
          if (JSON.stringify(filters) === JSON.stringify(applied)) void query.refetch()
        }}
      >
        <Input
          className="min-w-48 flex-1"
          type="search"
          aria-label={t('catalog.searchChannels')}
          placeholder={t('catalog.searchChannels')}
          value={filters.search}
          maxLength={100}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
        />
        <select
          className={selectClass + ' w-auto'}
          aria-label={t('catalog.allStates')}
          value={filters.state}
          onChange={(event) => setFilters({ ...filters, state: event.target.value })}
        >
          <option value="">{t('catalog.allStates')}</option>
          {['enabled', 'disabled'].map((state) => (
            <option key={state} value={state}>
              {t(state === 'enabled' ? 'catalog.enabledState' : 'catalog.disabledState')}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" disabled={query.isFetching}>
          {t('common.search')}
        </Button>
      </form>
      {notice ? (
        <p role="status" className="mb-4 text-xs text-primary">
          {t(notice.key, { count: notice.count })}
        </p>
      ) : null}
      {query.isPending || query.isError ? (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {query.data?.items.length ? (
            <DataTable
              rows={query.data.items}
              columns={[
                {
                  key: 'name',
                  label: t('catalog.channelName'),
                  render: (row) => (
                    <div className="min-w-40">
                      <strong className="text-foreground">{row.name}</strong>
                      <code className="block break-all text-[10px] text-muted-foreground">
                        {row.id}
                      </code>
                      <p className="text-muted-foreground">
                        {t(row.api_key_configured ? 'catalog.keySaved' : 'catalog.keyMissing')}
                      </p>
                      {row.circuit_state ? (
                        <p className="text-muted-foreground">
                          {t(`ops.circuit_${row.circuit_state}`)} ·{' '}
                          {new Intl.NumberFormat(i18n.resolvedLanguage).format(
                            row.consecutive_failures ?? 0,
                          )}
                        </p>
                      ) : null}
                      {row.last_error ? <ApiNotice error={new ApiError(row.last_error)} /> : null}
                    </div>
                  ),
                },
                {
                  key: 'url',
                  label: t('catalog.baseURL'),
                  render: (row) => (
                    <div className="min-w-44 max-w-80 break-all">
                      <code>{row.base_url}</code>
                      {row.note ? <p className="text-muted-foreground">{row.note}</p> : null}
                    </div>
                  ),
                },
                {
                  key: 'state',
                  label: t('catalog.enabled'),
                  render: (row) =>
                    t(row.enabled ? 'catalog.enabledState' : 'catalog.disabledState'),
                },
                {
                  key: 'priority',
                  label: t('catalog.priority') + ' / ' + t('catalog.weight'),
                  render: (row) => row.priority + ' / ' + row.weight,
                },
                {
                  key: 'actions',
                  label: t('common.actions'),
                  render: (row) => (
                    <ChannelActions
                      row={row}
                      onEdit={() => setEditor({ row })}
                      onImport={() => setImporting(row)}
                      onDelete={() => {
                        remove.reset()
                        setDeleting(row)
                      }}
                      onChanged={changed}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <div className="p-8 text-center">
              <h2>{t('catalog.noChannels')}</h2>
              <p className="mt-2 text-xs text-muted-foreground">{t('catalog.noChannelsHint')}</p>
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
      {editor ? (
        <UpstreamDialog
          row={editor.row}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            query.reset()
            changed()
          }}
        />
      ) : null}
      {importing ? (
        <ImportModelsDialog
          row={importing}
          onClose={() => setImporting(null)}
          onSaved={(count) => {
            setImporting(null)
            setNotice({ key: 'catalog.imported', count })
            invalidateCatalog(runtime, user?.id)
          }}
        />
      ) : null}
      <ModalDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={t('catalog.deleteChannel')}
        description={t('catalog.deleteChannelHint', { name: deleting?.name ?? '' })}
        busy={remove.isPending}
      >
        <ApiNotice error={remove.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('catalog.confirmDelete')}
          </Button>
        </div>
      </ModalDialog>
    </AdminPage>
  )
}
