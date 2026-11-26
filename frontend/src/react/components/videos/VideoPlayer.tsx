import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { videoAPI } from '../../../api/videos'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'

export function VideoPlayer({ fileId, download = true }: { fileId: string; download?: boolean }) {
  const { user } = useSession()
  const { t } = useTranslation()
  const refreshed = useRef<string | null>(null)
  const file = useQuery({
    queryKey: ['user', user?.id, 'video-asset', fileId],
    queryFn: ({ signal }) => videoAPI.asset(fileId, signal),
    enabled: Boolean(user),
    staleTime: 10 * 60 * 1000,
  })
  if (file.error) return <ApiNotice error={file.error} />
  if (!file.data)
    return (
      <p role="status" className="p-3 text-xs text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  return (
    <div className="grid min-w-0 gap-2">
      <video
        aria-label={t('video.playback')}
        controls
        playsInline
        preload="metadata"
        src={file.data.url}
        onError={() => {
          if (refreshed.current === fileId) return
          refreshed.current = fileId
          void file.refetch()
        }}
        className="aspect-video w-full rounded-lg bg-black object-contain"
      />
      {download ? (
        <Button variant="outline" size="sm" className="w-fit" asChild>
          <a href={file.data.url} download>
            <Download />
            {t('video.download')}
          </a>
        </Button>
      ) : null}
    </div>
  )
}
