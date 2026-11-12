import { useState } from 'react'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { images, type ImageFile } from '../../api/images'
import { operations } from '../../api/operations'
import { useRuntime } from '../app/context'
import { useSession } from '../features/auth/hooks'
import { useModels } from '../features/catalog/models'
import { addExistingReference } from '../features/images/references'
import { useImageActions } from '../features/images/actions'
import { ImageFilters } from '../components/images/ImageFilters'
import { GalleryGrid } from '../components/images/GalleryGrid'
import { ImagePreview } from '../components/images/ImagePreview'
import { ModalDialog } from '../components/ui/modal-dialog'
import { Button } from '../components/ui/button'
import { ApiNotice } from '../components/shared/ApiNotice'

function GalleryResults({ filter }: { filter: string }) {
  const runtime = useRuntime(),
    { user } = useSession(),
    { t } = useTranslation(),
    models = useModels('image'),
    navigate = useNavigate(),
    actions = useImageActions()
  const [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<string[] | null>(null),
    [batch, setBatch] = useState(false)
  const query = useInfiniteQuery({
    queryKey: ['user', user?.id, 'image-gallery', filter],
    enabled: !!user,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(filter)
      if (pageParam) params.set('cursor', pageParam)
      return images.gallery(params, signal)
    },
    getNextPageParam: (last) => last.next_cursor || undefined,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const refresh = () => {
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', user?.id, 'image-gallery'] })
    void runtime.queryClient.invalidateQueries({
      queryKey: ['user', user?.id, 'image-conversation'],
    })
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', user?.id, 'image-library'] })
  }
  const removal = useMutation({
    mutationFn: async () => {
      if (!deleting) return
      if (batch) await operations.deleteImages(deleting)
      else if (deleting[0]) await images.removeFile(deleting[0])
    },
    onSuccess: () => {
      setDeleting(null)
      setSelected([])
      refresh()
    },
  })
  const download = useMutation({ mutationFn: () => actions.downloadBatch(selected) })
  const edit = useMutation({
    mutationFn: async (file: ImageFile) => {
      if (await addExistingReference(runtime, models, file, '')) await navigate('/create')
    },
  })
  const busy = removal.isPending || download.isPending || edit.isPending
  const current = preview === null ? undefined : items[preview]
  return (
    <>
      <ApiNotice
        error={query.error || removal.error || download.error || actions.error || edit.error}
      />
      {actions.copied ? (
        <p role="status" className="text-xs">
          {t('images.copied')}
        </p>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-3 py-4 text-xs text-muted-foreground">
        <span>{t('ops.selected', { n: selected.length })}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected.length || selected.length > 50 || busy}
          onClick={() => download.mutate()}
        >
          {t('ops.downloadZIP')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          disabled={!selected.length || busy}
          onClick={() => {
            removal.reset()
            setBatch(true)
            setDeleting(selected)
          }}
        >
          {t('ops.batchDelete')}
        </Button>
      </div>
      {!query.isPending && !items.length ? (
        <div className="grid flex-1 place-content-center gap-3 py-10 text-center text-muted-foreground">
          <span className="mx-auto mb-1 grid size-12 place-items-center rounded-2xl bg-accent text-primary">
            <ImageIcon size={22} strokeWidth={1.6} />
          </span>
          <h2 className="text-base font-medium text-foreground">{t('images.emptyGallery')}</h2>
          <p className="text-sm">{t('images.galleryHint')}</p>
        </div>
      ) : (
        <GalleryGrid
          items={items}
          selected={selected}
          busy={busy}
          onSelect={(id, checked) =>
            setSelected((current) =>
              checked ? [...current, id] : current.filter((value) => value !== id),
            )
          }
          onPreview={setPreview}
          onDownload={(file) => {
            void actions.download(file)
          }}
          onCopy={(file) => {
            void actions.copy(file)
          }}
          onEdit={(file) => edit.mutate(file)}
          onDelete={(file) => {
            removal.reset()
            setBatch(false)
            setDeleting([file.id])
          }}
          hasMore={!!query.hasNextPage}
          loading={query.isFetching}
          onMore={() => {
            void query.fetchNextPage()
          }}
        />
      )}
      {preview !== null && current ? (
        <ImagePreview
          files={items.map((item) => item.file)}
          initialIndex={preview}
          prompt={current.prompt}
          parameters={[current.model_name, current.size, t('images.' + current.quality)].join(
            ' · ',
          )}
          onClose={() => setPreview(null)}
          onEdit={(file) => edit.mutate(file)}
          onNavigate={setPreview}
        />
      ) : null}
      <ModalDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={t(batch ? 'ops.batchDelete' : 'images.deleteTitle')}
        description={t(batch ? 'ops.batchImageConfirm' : 'images.deleteHint')}
        busy={removal.isPending}
      >
        <ApiNotice error={removal.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={removal.isPending} onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={removal.isPending}
            onClick={() => removal.mutate()}
          >
            {t(batch ? 'ops.confirm' : 'common.delete')}
          </Button>
        </div>
      </ModalDialog>
    </>
  )
}
export default function ImageGalleryPage() {
  const { t } = useTranslation(),
    { user } = useSession()
  const [filter, setFilter] = useState('limit=40')
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden px-4 pt-6 sm:px-8">
      <header className="mb-5 shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{t('images.gallery')}</h1>
        <p className="mt-1.5 text-xs text-muted-foreground">{t('images.galleryHint')}</p>
      </header>
      <ImageFilters onApply={(query) => setFilter(query.toString())} />
      <GalleryResults key={(user?.id ?? '') + ':' + filter} filter={filter} />
    </div>
  )
}
