import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { images, type ImageFile } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { Button } from '../ui/button'

export function ProtectedImage({
  file,
  original = false,
  alt,
  className = '',
}: {
  file: ImageFile
  original?: boolean
  alt: string
  className?: string
}) {
  const { t } = useTranslation()
  const { user } = useSession()
  const owner = user?.id
  const [result, setResult] = useState<{ source: string; url?: string; failed?: boolean } | null>(
    null,
  )
  const [retry, setRetry] = useState(0)
  const source = `${user?.id ?? ''}:${original ? file.url : file.thumbnail_url}:${file.expires_at}:${retry}`
  useEffect(() => {
    if (!owner) return
    const controller = new AbortController()
    let url = ''
    void images
      .blob(file, !original, controller.signal)
      .then((blob) => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob)
          setResult({ source, url })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ source, failed: true })
      })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, file, original, owner])
  return result?.source === source && result.url ? (
    <img
      src={result.url}
      alt={alt}
      width={original ? file.width : file.thumbnail_width}
      height={original ? file.height : file.thumbnail_height}
      decoding="async"
      className={className}
    />
  ) : result?.source === source && result.failed ? (
    <span role="status" className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
      {t('images.loadFailed')}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(event) => {
          event.stopPropagation()
          setRetry((value) => value + 1)
        }}
      >
        {t('images.refresh')}
      </Button>
    </span>
  ) : (
    <span role="status" className="text-xs text-muted-foreground">
      {t('images.loading')}
    </span>
  )
}
