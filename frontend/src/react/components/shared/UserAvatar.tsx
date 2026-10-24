import { useQuery } from '@tanstack/react-query'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { cn } from '../../lib/utils'
import { ProtectedImage } from '../images/ProtectedImage'

export function UserAvatar({ className = '' }: { className?: string }) {
  const { user } = useSession()
  const id = user?.avatar_file_id
  const query = useQuery({
    queryKey: ['user', user?.id, 'file', id],
    enabled: !!user && !!id,
    queryFn: ({ signal }) => images.file(id ?? '', signal),
  })
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent text-sm font-semibold text-primary',
        className,
      )}
    >
      {query.data ? (
        <ProtectedImage
          file={query.data}
          alt={user?.nickname ?? ''}
          className="size-full object-cover"
        />
      ) : (
        Array.from(user?.nickname || user?.email || '')[0]?.toUpperCase()
      )}
    </span>
  )
}
