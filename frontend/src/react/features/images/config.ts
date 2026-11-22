import { useQuery } from '@tanstack/react-query'
import { useSession } from '../auth/hooks'

/** Shared image configuration; chat also reads max_upload_bytes for reference uploads. */
export function useImageConfig(enabled = true) {
  const { user } = useSession()
  return useQuery({
    queryKey: ['user', user?.id, 'image-options'],
    enabled: !!user && enabled,
    queryFn: async ({ signal }) => {
      const { images } = await import('../../../api/images')
      return images.options(false, signal)
    },
  })
}
