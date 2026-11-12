import { useQuery } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { cn } from '../../lib/utils'
import { ProtectedImage } from './ProtectedImage'

export function ReferenceFile({ id }: { id: string }) {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'file', id],
    enabled: !!user,
    queryFn: ({ signal }) => images.file(id, signal),
  })
  return query.data ? (
    <ProtectedImage
      file={query.data}
      alt={t('images.references')}
      className="size-full object-cover"
    />
  ) : query.isError ? (
    <span className="grid size-full place-items-center text-muted-foreground">
      <AlertCircle size={14} aria-hidden="true" />
    </span>
  ) : (
    <span aria-hidden="true" className="lumi-shimmer block size-full" />
  )
}

/** Read-only reference thumbnails shown with a submitted task. */
export function ReferenceChips({
  ids,
  className = 'image-task-references',
}: {
  ids: readonly string[]
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {ids.map((id) => (
        <div
          key={id}
          className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted"
        >
          <ReferenceFile id={id} />
        </div>
      ))}
    </div>
  )
}
