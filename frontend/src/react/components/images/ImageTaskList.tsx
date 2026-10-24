import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageFile, ImageTask } from '../../../api/images'
import { Button } from '../ui/button'
import { ImageTaskCard } from './ImageTaskCard'

export function ImageTaskList({
  tasks,
  older,
  loading,
  onOlder,
  onCancel,
  onReuse,
  onEdit,
  onChanged,
}: {
  tasks: ImageTask[]
  older: boolean
  loading: boolean
  onOlder(): Promise<void>
  onCancel(task: ImageTask): Promise<void>
  onReuse(task: ImageTask): void
  onEdit(file: ImageFile): void
  onChanged(): void
}) {
  'use no memo'
  const { t } = useTranslation(),
    scroller = useRef<HTMLDivElement>(null),
    following = useRef(true)
  // TanStack's mutable getter API is isolated from compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 550,
    overscan: 3,
    enabled: tasks.length > 50,
    getItemKey: (index) => tasks[index]?.id ?? index,
    useFlushSync: false,
  })
  const tail = tasks.at(-1),
    stamp = tail ? tail.id + ':' + tail.version : ''
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (following.current && scroller.current)
        scroller.current.scrollTop = scroller.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [stamp])
  const card = (task: ImageTask) => (
    <ImageTaskCard
      key={task.id}
      task={task}
      onCancel={onCancel}
      onReuse={onReuse}
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
      onScroll={() => {
        const element = scroller.current
        if (element)
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
      }}
    >
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-8">
        {older ? (
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            className="my-3"
            onClick={() => {
              const old = scroller.current?.scrollHeight ?? 0,
                top = scroller.current?.scrollTop ?? 0
              following.current = false
              void onOlder().then(() =>
                requestAnimationFrame(() => {
                  if (scroller.current)
                    scroller.current.scrollTop = top + scroller.current.scrollHeight - old
                }),
              )
            }}
          >
            {t('images.older')}
          </Button>
        ) : null}
        {tasks.length > 50 ? (
          <div className="relative" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((row) => (
              <div
                key={row.key}
                ref={virtual.measureElement}
                data-index={row.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {tasks.slice(row.index, row.index + 1).map(card)}
              </div>
            ))}
          </div>
        ) : (
          tasks.map(card)
        )}
      </div>
    </div>
  )
}
