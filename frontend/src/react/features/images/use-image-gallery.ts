import { useInfiniteQuery } from '@tanstack/react-query'
import { images } from '../../../api/images'
import { useSession } from '../auth/hooks'

export const defaultGalleryFilter = 'limit=40'

export function useImageGallery(filter = defaultGalleryFilter) {
  const { user } = useSession()
  return useInfiniteQuery({
    queryKey: ['user', user?.id, 'image-gallery', filter],
    enabled: !!user,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(filter)
      if (pageParam) params.set('cursor', pageParam)
      return images.gallery(params, signal)
    },
    getNextPageParam: (page) => page.next_cursor || undefined,
  })
}
