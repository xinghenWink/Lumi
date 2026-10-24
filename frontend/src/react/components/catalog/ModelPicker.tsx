import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Boxes, Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelKind } from '../../../api/catalog-contracts'
import { useModels } from '../../features/catalog/models'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'

export function ModelPicker({ kind, disabled = false }: { kind: ModelKind; disabled?: boolean }) {
  const { t } = useTranslation()
  const { query, items, selected, select } = useModels(kind)
  return (
    <div className="min-w-0">
      <ApiNotice error={query.error} />
      {query.isError ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.retry')}
        </Button>
      ) : !query.isPending && !items.length ? (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {t('catalog.noAvailableHint')}
        </p>
      ) : null}
      <Dropdown.Root modal={false}>
        <Dropdown.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="catalog-model-trigger max-w-full justify-start px-2"
            aria-label={t('catalog.selectModel')}
            disabled={disabled || query.isPending || !selected}
          >
            {selected?.icon ? (
              <span aria-hidden="true">{selected.icon}</span>
            ) : (
              <Boxes size={15} className="shrink-0" />
            )}
            <span className="truncate">
              {query.isPending
                ? t('catalog.loadingModels')
                : (selected?.display_name ?? t('catalog.noAvailable'))}
            </span>
            <ChevronDown size={13} className="shrink-0" />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            side="top"
            align="start"
            sideOffset={10}
            collisionPadding={12}
            aria-label={t('catalog.availableModels')}
            className="z-70 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl"
          >
            {items.map((model) => (
              <Dropdown.Item
                key={model.id}
                onSelect={() => select(model.id)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 outline-none focus:bg-accent"
              >
                <span className="shrink-0 text-primary" aria-hidden="true">
                  {model.icon || <Boxes size={17} />}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs font-medium">
                    {model.display_name}
                  </strong>
                  {model.description ? (
                    <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
                      {model.description}
                    </span>
                  ) : null}
                </span>
                {model.id === selected?.id ? (
                  <Check size={16} className="shrink-0 text-primary" />
                ) : null}
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  )
}
