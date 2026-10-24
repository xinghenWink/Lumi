import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Copy, Download, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GalleryItem, ImageFile } from '../../../api/images'
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
                className="image-gallery-card overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                  <ProtectedImage
                    file={item.file}
                    alt={item.prompt}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute inset-0 rounded-t-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    aria-label={t('images.preview')}
                    onClick={() => onPreview(row.index * columns + offset)}
                  />
                  <label className="absolute top-2 left-2 flex items-center gap-2 rounded-lg bg-card/95 px-2 py-1 text-xs shadow-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.file.id)}
                      disabled={busy}
                      onChange={(event) => onSelect(item.file.id, event.target.checked)}
                    />
                    {t('ops.select')}
                  </label>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 min-h-10 break-words text-xs leading-5">
                    {item.prompt}
                  </p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {t('images.' + item.quality)} · {item.file.width} × {item.file.height}
                  </p>
                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('images.download')}
                      onClick={() => onDownload(item.file)}
                    >
                      <Download size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('images.copy')}
                      onClick={() => onCopy(item.file)}
                    >
                      <Copy size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('images.edit')}
                      onClick={() => onEdit(item.file)}
                    >
                      <Plus size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('images.delete')}
                      onClick={() => onDelete(item.file)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
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
        <Button variant="outline" className="my-3" disabled={loading} onClick={onMore}>
          {t('images.more')}
        </Button>
      ) : null}
    </div>
  )
}
