import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { catalog } from '../../../api/catalog'
import {
  defaultCapabilities,
  type Discovery,
  type ModelKind,
  type Upstream,
} from '../../../api/catalog-contracts'
import { ApiError } from '../../../api/transport'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { ModalDialog } from '../ui/modal-dialog'
import { Field, selectClass } from '../ui/field'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ApiNotice } from '../shared/ApiNotice'
import { CheckField } from './AdminFields'

function ImportForm({
  discovery,
  onClose,
  onSaved,
}: {
  discovery: Discovery
  onClose(): void
  onSaved(count: number): void
}) {
  const { user } = useSession(),
    { t } = useTranslation()
  const [candidates, setCandidates] = useState(() =>
    discovery.models.map((row, index) => ({
      id: row.id,
      selected: false,
      name: t('catalog.defaultAlias', { index: index + 1 }),
      type: 'chat' as ModelKind,
    })),
  )
  const [search, setSearch] = useState('')
  const selected = candidates.filter((row) => row.selected),
    visible = candidates.filter((row) => row.id.toLowerCase().includes(search.trim().toLowerCase()))
  const mutation = useOwnedMutation(user?.id, async (check) => {
    if (!selected.length || selected.length > 100 || selected.some((row) => !row.name.trim()))
      throw new ApiError('INVALID_INPUT')
    const result = await catalog.import(discovery.upstream_id, {
      version: discovery.version,
      models: selected.map((row) => ({
        remote_id: row.id,
        display_name: row.name.trim(),
        type: row.type,
        capabilities: defaultCapabilities(row.type),
      })),
    })
    check()
    onSaved(result.items.length)
  })
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('catalog.syncTitle')}
      description={t('catalog.syncHint')}
      busy={mutation.isPending}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <Input
          type="search"
          aria-label={t('catalog.remoteSearch')}
          placeholder={t('catalog.remoteSearch')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <fieldset
          disabled={mutation.isPending}
          className="max-h-[45dvh] space-y-3 overflow-y-auto overscroll-contain"
        >
          {visible.slice(0, 100).map((row) => (
            <section key={row.id} className="min-w-0 rounded-xl border border-border p-3">
              <CheckField
                label={t('catalog.selectRemote', { id: row.id })}
                checked={row.selected}
                disabled={!row.selected && selected.length >= 100}
                onChange={(selected) =>
                  setCandidates((rows) =>
                    rows.map((item) => (item.id === row.id ? { ...item, selected } : item)),
                  )
                }
              />
              {row.selected ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field id={'alias-' + row.id} label={t('catalog.modelName')}>
                    <Input
                      id={'alias-' + row.id}
                      aria-label={t('catalog.modelName') + ' ' + row.id}
                      value={row.name}
                      maxLength={80}
                      required
                      onChange={(event) =>
                        setCandidates((rows) =>
                          rows.map((item) =>
                            item.id === row.id ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field id={'kind-' + row.id} label={t('catalog.type')}>
                    <select
                      id={'kind-' + row.id}
                      aria-label={t('catalog.type') + ' ' + row.id}
                      className={selectClass}
                      value={row.type}
                      onChange={(event) =>
                        setCandidates((rows) =>
                          rows.map((item) =>
                            item.id === row.id
                              ? { ...item, type: event.target.value === 'image' ? 'image' : 'chat' }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="chat">{t('catalog.chat')}</option>
                      <option value="image">{t('catalog.image')}</option>
                    </select>
                  </Field>
                </div>
              ) : null}
            </section>
          ))}
          {!visible.length ? (
            <p className="text-xs text-muted-foreground">{t('catalog.noRemoteModels')}</p>
          ) : null}
        </fieldset>
        {visible.length > 100 ? (
          <p className="text-xs text-muted-foreground">{t('catalog.showFirst')}</p>
        ) : null}
        <p className="text-xs leading-6 text-muted-foreground">{t('catalog.importHint')}</p>
        <ApiNotice error={mutation.error} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {t('catalog.selected', { count: selected.length })}
          </span>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending || !selected.length}>
            {t('catalog.importModels')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
export function ImportModelsDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Upstream
  onClose(): void
  onSaved(count: number): void
}) {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-discovery', row.id, row.version],
    queryFn: ({ signal }) => catalog.discover(row.id, signal),
    enabled: !!user,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
  if (query.data)
    return (
      <ImportForm
        key={query.data.version}
        discovery={query.data}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('catalog.syncTitle')}
      description={t('catalog.syncHint')}
    >
      <ApiNotice error={query.error} />
      {query.isPending ? (
        <p role="status">{t('catalog.discovering')}</p>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.retry')}
        </Button>
      )}
    </ModalDialog>
  )
}
