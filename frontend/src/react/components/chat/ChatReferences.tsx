import { useQueries } from '@tanstack/react-query'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { ProtectedImage } from '../images/ProtectedImage'

export default function ChatReferences({ ids }: { ids: string[] }) {
  const { user } = useSession()
  const files = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['user', user?.id, 'file', id],
      enabled: !!user,
      queryFn: ({ signal }: { signal: AbortSignal }) => images.file(id, signal),
    })),
  })
  return (
    <div className="chat-reference-images mt-3 flex flex-wrap gap-2">
      {files.map((result, index) =>
        result.data ? (
          <ProtectedImage
            key={ids[index]}
            file={result.data}
            alt=""
            className="max-h-40 max-w-40 rounded-xl object-contain"
          />
        ) : null,
      )}
    </div>
  )
}
