import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { images, type ImageFile } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { useTime } from '../../features/accounts/time'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { ApiNotice } from '../shared/ApiNotice'
import { ProtectedImage } from './ProtectedImage'

export function ImageLibrary({
  onClose,
  onChoose,
  maxUploadBytes,
}: {
  onClose(): void
  onChoose(file: ImageFile): void
  maxUploadBytes: number
}) {
  const { t } = useTranslation(),
    { user } = useSession(),
    time = useTime()
  const query = useInfiniteQuery({
    queryKey: ['user', user?.id, 'image-library'],
    enabled: !!user,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      images.library(new URLSearchParams({ limit: '40', cursor: pageParam }), signal),
    getNextPageParam: (last) => last.next_cursor || undefined,
  })
  const files = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('images.library')}
      description={t('images.referenceHint', {
        size: (maxUploadBytes / 1_048_576).toLocaleString(),
      })}
      wide
    >
      <ApiNotice error={query.error} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {files.map((file) => (
          <div
            key={file.id}
            className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
          >
            <ProtectedImage
              file={file}
              alt={t('images.references')}
              className="size-full object-cover"
            />
            <button
              type="button"
              className="image-library-item absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={t('images.choose') + ' ' + time(file.created_at)}
              onClick={() => {
                onChoose(file)
                onClose()
              }}
            />
          </div>
        ))}
      </div>
      {query.isPending ? (
        <p role="status" className="py-4 text-sm">
          {t('images.loading')}
        </p>
      ) : !files.length ? (
        <p className="py-6 text-sm text-muted-foreground">{t('images.emptyGallery')}</p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="outline"
          className="mt-4"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage()
          }}
        >
          {t('images.more')}
        </Button>
      ) : null}
    </ModalDialog>
  )
}
