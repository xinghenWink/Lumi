import { useQuery } from '@tanstack/react-query'
import { images } from '../../../api/images'
import { useSession } from '../auth/hooks'

/** Shared image configuration; chat also reads max_upload_bytes for reference uploads. */
export function useImageConfig(enabled = true) {
  const { user } = useSession()
  return useQuery({
    queryKey: ['user', user?.id, 'image-options'],
    enabled: !!user && enabled,
    queryFn: ({ signal }) => images.options(false, signal),
  })
}
