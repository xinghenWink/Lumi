import * as Popover from '@radix-ui/react-popover'
import { FolderOpen, Funnel, Search } from 'lucide-react'
import { useId, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  datePresets,
  emptyTaskFilters,
  recentTaskDates,
  taskQualities,
  taskStatuses,
  type TaskFilters,
} from '../../features/images/task-filters'
import { Button } from '../ui/button'
import { Field, FieldGroup } from '../ui/field'
import { Input } from '../ui/input'
import { NativeSelect, NativeSelectOption } from '../ui/native-select'

const popoverClass =
  'z-50 w-80 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg animate-fade-in'

export function ImageWorkspaceTools({
  disabled,
  search,
  filters,
  assetsOpen,
  assetsDialog,
  assetsTrigger,
  onSearch,
  onFilter,
  onAssetsToggle,
}: {
  disabled: boolean
  search: string
  filters: TaskFilters
  assetsOpen: boolean
  assetsDialog: boolean
  assetsTrigger: RefObject<HTMLButtonElement | null>
  onSearch(value: string): void
  onFilter(value: TaskFilters): void
  onAssetsToggle(): void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<'search' | 'filter' | null>(null)
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState(filters)
  const id = useId()
  const hasFilters = Object.values(filters).some(Boolean)
  const invalidRange = !!(draft.from && draft.until && draft.from > draft.until)
  const close = () => setOpen(null)
  return (
    <div
      role="group"
      aria-label={t('images.workspaceTools')}
      className="flex shrink-0 items-center gap-0.5 rounded-xl border border-border bg-card p-0.5"
    >
      <Popover.Root
        open={open === 'search'}
        onOpenChange={(value) => {
          if (value) setKeyword(search)
          setOpen((current) => (value ? 'search' : current === 'search' ? null : current))
        }}
      >
        <Popover.Trigger asChild>
          <Button
            type="button"
            disabled={disabled}
            variant={search ? 'secondary' : 'ghost'}
            size="icon-sm"
            className="size-10 sm:size-8"
            aria-label={t('images.searchTasks')}
            title={search ? t('images.searchActive', { keyword: search }) : t('images.searchTasks')}
          >
            <Search size={17} aria-hidden="true" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={t('images.searchTasks')}
            sideOffset={8}
            align="end"
            collisionPadding={12}
            className={popoverClass}
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                onSearch(keyword.trim())
                close()
              }}
            >
              <Field id={id + '-search'} label={t('images.searchTasks')}>
                <Input
                  id={id + '-search'}
                  type="search"
                  placeholder={t('images.searchPromptPlaceholder')}
                  value={keyword}
                  onChange={(event) =>
                    setKeyword(Array.from(event.target.value).slice(0, 100).join(''))
                  }
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!search}
                  onClick={() => {
                    onSearch('')
                    close()
                  }}
                >
                  {t('images.clearSearch')}
                </Button>
                <Button type="submit" size="sm">
                  {t('images.searchAction')}
                </Button>
              </div>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Popover.Root
        open={open === 'filter'}
        onOpenChange={(value) => {
          if (value) setDraft(filters)
          setOpen((current) => (value ? 'filter' : current === 'filter' ? null : current))
        }}
      >
        <Popover.Trigger asChild>
          <Button
            type="button"
            disabled={disabled}
            variant={hasFilters ? 'secondary' : 'ghost'}
            size="icon-sm"
            className="size-10 sm:size-8"
            aria-label={t('images.filterTasks')}
            title={t(hasFilters ? 'images.filterActive' : 'images.filterTasks')}
          >
            <Funnel size={17} aria-hidden="true" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={t('images.filterTasks')}
            sideOffset={8}
            align="end"
            collisionPadding={12}
            className={popoverClass}
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (invalidRange) return
                onFilter(draft)
                close()
              }}
            >
              <FieldGroup className="grid grid-cols-2 gap-2">
                <Field id={id + '-from'} label={t('images.from')} invalid={invalidRange}>
                  <Input
                    id={id + '-from'}
                    type="date"
                    className="px-1.5"
                    value={draft.from}
                    max={draft.until || '9999-12-30'}
                    aria-invalid={invalidRange}
                    onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                  />
                </Field>
                <Field id={id + '-until'} label={t('images.until')} invalid={invalidRange}>
                  <Input
                    id={id + '-until'}
                    type="date"
                    className="px-1.5"
                    value={draft.until}
                    min={draft.from || undefined}
                    max="9999-12-30"
                    aria-invalid={invalidRange}
                    onChange={(event) => setDraft({ ...draft, until: event.target.value })}
                  />
                </Field>
              </FieldGroup>
              {invalidRange ? (
                <p role="alert" className="text-xs text-destructive">
                  {t('images.invalidDateRange')}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {datePresets.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDraft({ ...draft, ...recentTaskDates(preset) })}
                  >
                    {t('images.datePreset.' + preset)}
                  </Button>
                ))}
              </div>
              <FieldGroup className="grid grid-cols-2 gap-2">
                <Field id={id + '-state'} label={t('images.status')}>
                  <NativeSelect
                    id={id + '-state'}
                    value={draft.state}
                    onChange={(event) => {
                      const state = taskStatuses.find((value) => value === event.target.value) ?? ''
                      setDraft({ ...draft, state })
                    }}
                  >
                    <NativeSelectOption value="">{t('images.all')}</NativeSelectOption>
                    {taskStatuses.map((status) => (
                      <NativeSelectOption key={status} value={status}>
                        {t('images.' + status)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id={id + '-quality'} label={t('images.quality')}>
                  <NativeSelect
                    id={id + '-quality'}
                    value={draft.quality}
                    onChange={(event) => {
                      const quality =
                        taskQualities.find((value) => value === event.target.value) ?? ''
                      setDraft({ ...draft, quality })
                    }}
                  >
                    <NativeSelectOption value="">{t('images.all')}</NativeSelectOption>
                    {taskQualities.map((quality) => (
                      <NativeSelectOption key={quality} value={quality}>
                        {t('images.' + quality)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </FieldGroup>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!hasFilters && !Object.values(draft).some(Boolean)}
                  onClick={() => {
                    onFilter(emptyTaskFilters)
                    close()
                  }}
                >
                  {t('images.clearFilters')}
                </Button>
                <Button type="submit" size="sm" disabled={invalidRange}>
                  {t('images.applyFilters')}
                </Button>
              </div>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Button
        ref={assetsTrigger}
        type="button"
        variant={assetsOpen ? 'secondary' : 'ghost'}
        size="icon-sm"
        className="size-10 sm:size-8"
        aria-label={t('images.assets')}
        title={t('images.assets')}
        aria-expanded={assetsOpen}
        aria-haspopup={assetsDialog ? 'dialog' : undefined}
        onClick={() => {
          close()
          onAssetsToggle()
        }}
      >
        <FolderOpen size={17} aria-hidden="true" />
      </Button>
    </div>
  )
}
