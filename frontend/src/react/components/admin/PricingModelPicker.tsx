import { useState, type RefObject } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PlatformModel } from '../../../api/catalog-contracts'
import { cn } from '../../lib/utils'
import { PageStatus } from '../shared/PageStatus'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ModalDialog } from '../ui/modal-dialog'

export function PricingModelDetails({
  modelId,
  model,
  catalogLoaded,
}: {
  modelId: string
  model: PlatformModel | undefined
  catalogLoaded: boolean
}) {
  const { t } = useTranslation()
  const channels =
    model && new Map(model.routes.map((route) => [route.upstream_id, route.upstream_name]))
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1 text-left whitespace-normal">
      <span className="break-words font-medium">
        {model?.display_name ??
          t(catalogLoaded ? 'credits.modelMissing' : 'credits.modelDetailsUnavailable')}
        {model && !model.enabled ? (
          <span className="ml-2 text-xs text-muted-foreground">{t('catalog.disabledState')}</span>
        ) : null}
      </span>
      <code className="text-xs break-all text-muted-foreground">{modelId}</code>
      {channels ? (
        <span className="text-xs break-words text-muted-foreground">
          {channels.size
            ? t('credits.modelChannels', {
                names: [...channels.values()].join(t('credits.channelSeparator')),
              })
            : t('catalog.noRoutes')}
        </span>
      ) : null}
    </span>
  )
}

export function PricingModelPicker({
  models,
  error,
  selected,
  returnFocus,
  onRetry,
  onSelect,
  onClose,
}: {
  models: readonly PlatformModel[] | undefined
  error: unknown
  selected: string
  returnFocus: RefObject<HTMLElement | null>
  onRetry(): void
  onSelect(id: string): void
  onClose(): void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const term = search.trim().toLocaleLowerCase()
  const available = models?.filter((model) => model.enabled)
  const matches = available?.filter(
    (model) =>
      model.id.includes(term) ||
      model.display_name.toLocaleLowerCase().includes(term) ||
      model.routes.some((route) => route.upstream_name.toLocaleLowerCase().includes(term)),
  )

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('credits.selectPricingModel')}
      description={t('credits.selectPricingModelHint')}
      returnFocus={returnFocus}
    >
      <Input
        type="search"
        aria-label={t('credits.searchPricingModelsLabel')}
        placeholder={t('credits.searchPricingModels')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {error || !models ? (
        <PageStatus error={error} retry={onRetry} />
      ) : matches?.length ? (
        <div
          className="mt-3 grid max-h-[45dvh] gap-1.5 overflow-y-auto p-1"
          role="group"
          aria-label={t('credits.availablePricingModels')}
        >
          {matches.map((model) => (
            <Button
              key={model.id}
              type="button"
              variant="outline"
              aria-pressed={model.id === selected}
              className={cn(
                'h-auto min-h-11 w-full justify-between px-3 py-2',
                model.id === selected && 'bg-accent',
              )}
              onClick={() => onSelect(model.id)}
            >
              <PricingModelDetails modelId={model.id} model={model} catalogLoaded />
              {model.id === selected ? <Check size={16} aria-hidden="true" /> : null}
            </Button>
          ))}
        </div>
      ) : (
        <p role="status" className="my-5 text-sm text-muted-foreground">
          {t(available?.length ? 'credits.noMatchingPricingModels' : 'credits.noPricingModels')}
        </p>
      )}
    </ModalDialog>
  )
}
