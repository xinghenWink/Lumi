import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Copy, Download, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GalleryItem, ImageFile } from '../../../api/images'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { ProtectedImage } from './ProtectedImage'

export function GalleryGrid({
  items,
  selected,
  busy,
  onSelect,
  onPreview,
  onDownload,
  onCopy,
  onEdit,
  onDelete,
  hasMore,
  loading,
  onMore,
}: {
  items: GalleryItem[]
  selected: string[]
  busy: boolean
  onSelect(id: string, value: boolean): void
  onPreview(index: number): void
  onDownload(file: ImageFile): void
  onCopy(file: ImageFile): void
  onEdit(file: ImageFile): void
  onDelete(file: ImageFile): void
  hasMore: boolean
  loading: boolean
  onMore(): void
}) {
  'use no memo'
  const action =
    'size-7 rounded-lg text-foreground hover:bg-foreground/10 focus-visible:outline-offset-0'
  const { t } = useTranslation(),
    scroller = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  useEffect(() => {
    if (!scroller.current) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setColumns(width < 500 ? 1 : width < 850 ? 2 : width < 1200 ? 3 : 4)
    })
    observer.observe(scroller.current)
    return () => observer.disconnect()
  }, [])
  // TanStack's mutable getter API is isolated from compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: Math.ceil(items.length / columns),
    getScrollElement: () => scroller.current,
    estimateSize: () => 340,
    overscan: 2,
    useFlushSync: false,
  })
  return (
    <div
      ref={scroller}
      className="image-gallery-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
      tabIndex={0}
      aria-label={t('images.gallery')}
    >
      <div className="relative" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((row) => (
          <div
            key={row.key}
            ref={virtual.measureElement}
            data-index={row.index}
            className="absolute top-0 left-0 grid w-full gap-4 pb-4"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {items.slice(row.index * columns, (row.index + 1) * columns).map((item, offset) => (
              <article
                key={item.file.id}
                className={cn(
                  'image-gallery-card group overflow-hidden rounded-2xl border bg-card shadow-xs transition-[border-color,box-shadow] hover:shadow-md',
                  selected.includes(item.file.id)
                    ? 'border-primary/60 ring-2 ring-primary/15'
                    : 'border-border',
                )}
              >
                <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                  <ProtectedImage
                    file={item.file}
                    alt={item.prompt}
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                  <button
                    type="button"
                    className="absolute inset-0 cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    aria-label={t('images.preview')}
                    onClick={() => onPreview(row.index * columns + offset)}
                  />
                  <label className="absolute top-2 left-2 flex cursor-pointer items-center gap-1.5 rounded-lg bg-background/85 px-2 py-1 text-xs shadow-sm backdrop-blur">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={selected.includes(item.file.id)}
                      disabled={busy}
                      onChange={(event) => onSelect(item.file.id, event.target.checked)}
                    />
                    {t('ops.select')}
                  </label>
                  <div className="reveal-on-hover absolute top-2 right-2 flex items-center gap-0.5 rounded-xl bg-background/85 p-0.5 shadow-sm backdrop-blur">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={action}
                      aria-label={t('images.download')}
                      title={t('images.download')}
                      onClick={() => onDownload(item.file)}
                    >
                      <Download size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={action}
                      aria-label={t('images.copy')}
                      title={t('images.copy')}
                      onClick={() => onCopy(item.file)}
                    >
                      <Copy size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={action}
                      aria-label={t('images.edit')}
                      title={t('images.edit')}
                      onClick={() => onEdit(item.file)}
                    >
                      <Plus size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={action}
                      aria-label={t('images.delete')}
                      title={t('images.delete')}
                      onClick={() => onDelete(item.file)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="px-3.5 pt-3 pb-3.5">
                  <p className="line-clamp-2 min-h-10 text-xs leading-5 break-words">
                    {item.prompt}
                  </p>
                  <p className="mt-1.5 text-2xs text-muted-foreground tabular-nums">
                    {t('images.' + item.quality)} · {item.file.width} × {item.file.height}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ))}
      </div>
      {loading ? (
        <p role="status" className="py-3 text-center text-xs text-muted-foreground">
          {t('images.loading')}
        </p>
      ) : null}
      {hasMore ? (
        <Button
          variant="outline"
          size="sm"
          className="mx-auto my-4 flex"
          disabled={loading}
          onClick={onMore}
        >
          {t('images.more')}
        </Button>
      ) : null}
    </div>
  )
}
