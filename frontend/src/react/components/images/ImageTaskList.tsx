import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageFile, ImageTask } from '../../../api/images'
import { prefersReducedMotion } from '../../lib/media'
import { Button } from '../ui/button'
import { ImageTaskCard } from './ImageTaskCard'

function SubmittingCard() {
  const { t } = useTranslation()
  return (
    <div aria-hidden="true" className="border-b border-border py-6 animate-rise-in">
      <div className="mb-4 h-4 w-2/3 rounded-full lumi-shimmer" />
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        {t('react.submitting')}
      </div>
      <div className="aspect-[4/3] max-w-md rounded-2xl lumi-shimmer" />
    </div>
  )
}

/** Image results, newest first; older pages load at the bottom. */
export function ImageTaskList({
  tasks,
  older,
  loading,
  submitting = false,
  onOlder,
  onCancel,
  onReuse,
  onRegenerate,
  reuseDisabled,
  regenerateDisabled,
  onEdit,
  onChanged,
}: {
  tasks: ImageTask[]
  older: boolean
  loading: boolean
  submitting?: boolean
  onOlder(): Promise<void>
  onCancel(task: ImageTask): Promise<void>
  onReuse(task: ImageTask): void
  onRegenerate(task: ImageTask): void
  reuseDisabled: boolean
  regenerateDisabled: boolean
  onEdit(file: ImageFile): void
  onChanged(): void
}) {
  'use no memo'
  const { t } = useTranslation(),
    scroller = useRef<HTMLDivElement>(null)
  // The controller keeps tasks chronological; only the view is reversed.
  const ordered = tasks.slice().reverse()
  // TanStack's mutable getter API is isolated from compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 550,
    overscan: 3,
    enabled: ordered.length > 50,
    getItemKey: (index) => ordered[index]?.id ?? index,
    useFlushSync: false,
  })
  const head = ordered[0]?.id
  const seen = useRef(head)
  useEffect(() => {
    // A new head is a submission from this composer: bring it into view.
    if (head === seen.current && !submitting) return
    if (head !== seen.current) seen.current = head
    scroller.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [head, submitting])
  const card = (task: ImageTask) => (
    <ImageTaskCard
      key={task.id}
      task={task}
      onCancel={onCancel}
      onReuse={onReuse}
      onRegenerate={onRegenerate}
      reuseDisabled={reuseDisabled}
      regenerateDisabled={regenerateDisabled}
      onEdit={onEdit}
      onChanged={onChanged}
    />
  )
  return (
    <div
      ref={scroller}
      className="image-task-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
      tabIndex={0}
      aria-label={t('images.history')}
    >
      <div className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
        {submitting ? <SubmittingCard /> : null}
        {ordered.length > 50 ? (
          <div className="relative" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((row) => (
              <div
                key={row.key}
                ref={virtual.measureElement}
                data-index={row.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {ordered.slice(row.index, row.index + 1).map(card)}
              </div>
            ))}
          </div>
        ) : (
          ordered.map(card)
        )}
        {older ? (
          <div className="flex justify-center pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => {
                void onOlder()
              }}
            >
              {t('images.older')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
