import { useQuery } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { cn } from '../../lib/utils'
import { ProtectedImage } from './ProtectedImage'
import { ReferencePreviewButton } from './ReferencePreviewButton'

function ReferenceFile({
  id,
  position,
  previewable,
}: {
  id: string
  position: number
  previewable: boolean
}) {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'file', id],
    enabled: !!user,
    queryFn: ({ signal }) => images.file(id, signal),
  })
  const file = query.data
  return file ? (
    <ProtectedImage
      file={file}
      alt={t('images.references')}
      className="size-full object-cover"
      {...(previewable
        ? {
            renderImage: (image: ReactNode) => (
              <ReferencePreviewButton file={file} position={position}>
                {image}
              </ReferencePreviewButton>
            ),
          }
        : {})}
    />
  ) : query.isError ? (
    <span className="grid size-full place-items-center text-muted-foreground">
      <AlertCircle size={14} aria-hidden="true" />
    </span>
  ) : (
    <span aria-hidden="true" className="lumi-shimmer block size-full" />
  )
}

/** Reference thumbnails shown with a submitted task. */
export function ReferenceChips({
  ids,
  className = 'image-task-references',
  previewable = true,
}: {
  ids: readonly string[]
  className?: string
  previewable?: boolean
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {ids.map((id, index) => (
        <div
          key={id}
          className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted"
        >
          <ReferenceFile id={id} position={index + 1} previewable={previewable} />
        </div>
      ))}
    </div>
  )
}
