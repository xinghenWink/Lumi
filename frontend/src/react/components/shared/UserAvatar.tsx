import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../features/auth/hooks'
import { Avatar, AvatarFallback } from '../ui/avatar'
const ProtectedImage = lazy(() =>
  import('../images/ProtectedImage').then((module) => ({ default: module.ProtectedImage })),
)

export function UserAvatar({ className = '' }: { className?: string }) {
  const { user } = useSession()
  const id = user?.avatar_file_id
  const query = useQuery({
    queryKey: ['user', user?.id, 'file', id],
    enabled: !!user && !!id,
    queryFn: async ({ signal }) => {
      const { images } = await import('../../../api/images')
      return images.file(id ?? '', signal)
    },
  })

  const fallback = (
    <AvatarFallback className="bg-accent text-[13px] font-semibold text-primary">
      {Array.from(user?.nickname || user?.email || '')[0]?.toUpperCase()}
    </AvatarFallback>
  )
  return (
    <Avatar className={className}>
      {query.data ? (
        <Suspense fallback={fallback}>
          <ProtectedImage
            file={query.data}
            alt={user?.nickname ?? ''}
            className="size-full object-cover"
            fallback={fallback}
          />
        </Suspense>
      ) : (
        fallback
      )}
    </Avatar>
  )
}
