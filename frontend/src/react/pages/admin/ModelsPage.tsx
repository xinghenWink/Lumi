import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { catalog } from '../../../api/catalog'
import type { PlatformModel } from '../../../api/catalog-contracts'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useCursorQuery } from '../../features/accounts/resources'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { invalidateCatalog, modelInput } from '../../features/admin/catalog'
import { AdminPage } from '../../components/admin/AdminPage'
import { ModelEditor } from '../../components/admin/ModelEditor'
import { DataTable } from '../../components/shared/DataTable'
import { CursorControls } from '../../components/shared/CursorControls'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { PageStatus } from '../../components/shared/PageStatus'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { selectClass } from '../../components/ui/field'
import { ModalDialog } from '../../components/ui/modal-dialog'

function ModelActions({
  row,
  onEdit,
  onDelete,
  onChanged,
}: {
  row: PlatformModel
  onEdit(): void
  onDelete(): void
  onChanged(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation()
  const toggle = useOwnedMutation(user?.id, async (check) => {
    await catalog.saveModel(
      {
        ...modelInput(row),
        enabled: !row.enabled,
        is_default: row.enabled ? false : row.is_default,
      },
      row.id,
    )
    check()
    onChanged()
  })
  return (
    <div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('catalog.editModel') + ' ' + row.display_name}
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
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          aria-label={t('catalog.deleteModel') + ' ' + row.display_name}
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </Button>
      </div>
      <ApiNotice error={toggle.error} />
    </div>
  )
}
export default function ModelsPage() {
  const runtime = useRuntime(),
    { user } = useSession(),
    { t } = useTranslation()
  const [filters, setFilters] = useState({ search: '', state: '', type: '' }),
    [applied, setApplied] = useState(filters)
  const [editor, setEditor] = useState<{ model: PlatformModel | null } | null>(null),
    [deleting, setDeleting] = useState<PlatformModel | null>(null),
    [notice, setNotice] = useState('')
  const query = useCursorQuery(
    ['user', user?.id, 'admin-models', applied],
    (cursor, signal) =>
      catalog.models(new URLSearchParams({ ...applied, cursor, limit: '20' }), signal),
    !!user,
  )
  const remove = useOwnedMutation(user?.id, async (check) => {
    if (!deleting) return
    await catalog.deleteModel(deleting.id)
    check()
    setDeleting(null)
    setNotice('catalog.modelDeleted')
    query.reset()
    invalidateCatalog(runtime, user?.id)
  })
  function changed() {
    setNotice('catalog.modelSaved')
    invalidateCatalog(runtime, user?.id)
  }
  return (
    <AdminPage
      title={t('catalog.modelsTitle')}
      description={t('catalog.modelsDescription')}
      actions={
        <Button onClick={() => setEditor({ model: null })}>
          <Plus size={16} />
          {t('catalog.newModel')}
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
          value={filters.search}
          maxLength={100}
          aria-label={t('catalog.searchModels')}
          placeholder={t('catalog.searchModels')}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
        />
        <select
          className={selectClass + ' w-auto'}
          aria-label={t('catalog.type')}
          value={filters.type}
          onChange={(event) => setFilters({ ...filters, type: event.target.value })}
        >
          <option value="">{t('catalog.allTypes')}</option>
          {['chat', 'image'].map((type) => (
            <option key={type} value={type}>
              {t(`catalog.${type}`)}
            </option>
          ))}
        </select>
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
          {t(notice)}
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
                  label: t('catalog.modelName'),
                  render: (row) => (
                    <div className="min-w-40">
                      <strong>{row.display_name}</strong>
                      {row.is_default ? (
                        <span className="ml-2 rounded bg-accent px-2 py-1 text-primary">
                          {t('catalog.defaultState')}
                        </span>
                      ) : null}
                      <code className="block break-all text-[10px] text-muted-foreground">
                        {row.id}
                      </code>
                      <p className="text-muted-foreground">{row.description}</p>
                    </div>
                  ),
                },
                {
                  key: 'type',
                  label: t('catalog.type'),
                  render: (row) => t(`catalog.${row.type}`),
                },
                {
                  key: 'state',
                  label: t('catalog.enabled'),
                  render: (row) =>
                    t(row.enabled ? 'catalog.enabledState' : 'catalog.disabledState'),
                },
                {
                  key: 'routes',
                  label: t('catalog.routes'),
                  render: (row) =>
                    row.routes.length ? (
                      <div className="min-w-36 space-y-2">
                        {row.routes.map((route) => (
                          <p
                            key={route.id}
                            className={
                              route.enabled && route.upstream_enabled ? '' : 'text-muted-foreground'
                            }
                          >
                            {route.upstream_name}
                            <code className="block break-all text-[10px]">
                              {route.upstream_model_name}
                            </code>
                          </p>
                        ))}
                      </div>
                    ) : (
                      t('catalog.noRoutes')
                    ),
                },
                { key: 'order', label: t('catalog.sortOrder'), render: (row) => row.sort_order },
                {
                  key: 'actions',
                  label: t('common.actions'),
                  render: (row) => (
                    <ModelActions
                      row={row}
                      onEdit={() => setEditor({ model: row })}
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
              <h2>{t('catalog.noModels')}</h2>
              <p className="mt-2 text-xs text-muted-foreground">{t('catalog.noModelsHint')}</p>
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
        <ModelEditor
          model={editor.model}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            query.reset()
            changed()
          }}
        />
      ) : null}
      <ModalDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={t('catalog.deleteModel')}
        description={t('catalog.deleteModelHint', { name: deleting?.display_name ?? '' })}
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
