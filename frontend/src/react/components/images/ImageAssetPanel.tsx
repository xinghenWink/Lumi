import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GalleryItem } from '../../../api/images'
import { useImageGallery } from '../../features/images/use-image-gallery'
import { ApiNotice } from '../shared/ApiNotice'
import { PageStatus } from '../shared/PageStatus'
import { Button } from '../ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet'
import { GalleryGrid } from './GalleryGrid'
import { ImagePreview } from './ImagePreview'

export default function ImageAssetPanel({
  docked,
  onClose,
  conversationId,
}: {
  docked: boolean
  onClose(): void
  conversationId: string
}) {
  const { t } = useTranslation()
  const query = useImageGallery()
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const [preview, setPreview] = useState<GalleryItem | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previewTrigger = useRef<HTMLElement>(null)
  useEffect(() => {
    if (docked) closeButton.current?.focus({ preventScroll: true })
  }, [docked])

  const close = (
    <Button
      ref={closeButton}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t('common.close')}
      onClick={docked ? onClose : undefined}
    >
      <X size={18} aria-hidden="true" />
    </Button>
  )
  const results =
    !query.data || (!items.length && query.error) ? (
      <PageStatus error={query.error} retry={() => void query.refetch()} />
    ) : items.length ? (
      <div className="flex min-h-0 flex-1 flex-col px-3">
        <ApiNotice error={query.error} />
        {query.error && !query.isFetchNextPageError ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="my-2 self-start"
            onClick={() => void query.refetch()}
          >
            {t('common.retry')}
          </Button>
        ) : null}
        <GalleryGrid
          compact
          items={items}
          onPreview={(index, trigger) => {
            const item = items[index]
            if (!item) return
            previewTrigger.current = trigger
            setPreview(item)
          }}
          hasMore={!!query.hasNextPage}
          loading={query.isFetching}
          onMore={() => void query.fetchNextPage()}
        />
      </div>
    ) : (
      <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t('images.emptyGallery')}
      </p>
    )
  const detail = preview ? (
    <ImagePreview
      files={[preview.file]}
      prompt={preview.prompt}
      parameters={[preview.model_name, preview.size, t('images.' + preview.quality)].join(' · ')}
      returnFocus={previewTrigger}
      editor={{
        conversationId,
        modelId: preview.model_id,
        quality: preview.quality,
        size: preview.size,
        ratio: preview.ratio,
      }}
      onClose={() => {
        if (!previewTrigger.current?.isConnected) previewTrigger.current = closeButton.current
        setPreview(null)
      }}
    />
  ) : null
  const header = 'flex shrink-0 items-center justify-between gap-2 px-3 py-2.5'
  return docked ? (
    <aside
      aria-label={t('images.assets')}
      className="flex w-[360px] shrink-0 flex-col border-l border-border bg-card animate-fade-in"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !preview &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <header className={header}>
        <h2 className="text-sm font-semibold">{t('images.assets')}</h2>
        {close}
      </header>
      {results}
      {detail}
    </aside>
  ) : (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="w-[360px] max-w-full overflow-hidden bg-card"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <header className={header}>
          <SheetTitle className="text-sm">{t('images.assets')}</SheetTitle>
          <SheetDescription className="sr-only">{t('images.galleryHint')}</SheetDescription>
          <SheetClose asChild>{close}</SheetClose>
        </header>
        {results}
        {detail}
      </SheetContent>
    </Sheet>
  )
}
