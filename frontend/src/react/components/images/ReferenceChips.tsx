import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from '../shared/ApiNotice'
import { ProtectedImage } from './ProtectedImage'
import { Button } from '../ui/button'

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
      className="size-full rounded-lg object-cover"
    />
  ) : (
    <ApiNotice error={query.error} />
  )
}
export function ReferenceChips({
  ids,
  onRemove,
  disabled = false,
  className = 'image-references',
}: {
  ids: string[]
  onRemove?: (id: string) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={className + ' flex flex-wrap gap-3 py-2'}>
      {ids.map((id) => (
        <div key={id} className="relative size-16 rounded-lg border border-border bg-muted">
          <ReferenceFile id={id} />
          {onRemove ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="absolute -top-1 -right-1 size-6 rounded-full"
              disabled={disabled}
              aria-label={t('images.removeReference')}
              onClick={() => onRemove(id)}
            >
              <X size={12} />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
