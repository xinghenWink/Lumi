import { useQuery } from '@tanstack/react-query'
import { AlertCircle, RotateCw, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import type { Rejections } from '../../features/files/reference-rules'
import type { UploadItem } from '../../features/files/reference-uploads'
import { errorText } from '../../lib/errors'
import { cn } from '../../lib/utils'
import { Attachment, AttachmentAction, AttachmentMedia } from '../ui/attachment'
import { ProtectedImage } from '../images/ProtectedImage'

const chip =
  'group relative size-16 shrink-0 gap-0 overflow-hidden p-0 rounded-xl border border-border bg-muted shadow-xs animate-rise-in'
const corner =
  'absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-foreground/75 text-background shadow-sm transition-[opacity,background-color] hover:bg-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40'

function Committed({
  id,
  preview,
  disabled,
  onRemove,
}: {
  id: string
  preview: string | undefined
  disabled: boolean
  onRemove: ((id: string) => void) | undefined
}) {
  const { t, i18n } = useTranslation()
  const { user } = useSession()
  const query = useQuery({
    queryKey: ['user', user?.id, 'file', id],
    enabled: !!user && !preview,
    queryFn: ({ signal }) => images.file(id, signal),
  })
  return (
    <Attachment className={chip}>
      <AttachmentMedia className="relative size-full rounded-none">
        {preview ? (
          <img src={preview} alt={t('images.references')} className="size-full object-cover" />
        ) : query.data ? (
          <ProtectedImage
            file={query.data}
            alt={t('images.references')}
            className="size-full object-cover"
          />
        ) : query.isError ? (
          <span
            className="grid size-full place-items-center text-destructive"
            title={errorText(t, i18n, query.error)}
          >
            <AlertCircle size={18} aria-hidden="true" />
            <span className="sr-only">{errorText(t, i18n, query.error)}</span>
          </span>
        ) : (
          <span aria-hidden="true" className="lumi-shimmer block size-full" />
        )}
      </AttachmentMedia>
      {onRemove ? (
        <AttachmentAction
          type="button"
          className={cn(corner, 'reveal-on-hover')}
          disabled={disabled}
          aria-label={t('images.removeReference')}
          onClick={() => onRemove(id)}
        >
          <X size={12} strokeWidth={2.5} />
        </AttachmentAction>
      ) : null}
    </Attachment>
  )
}

function Local({
  item,
  onRetry,
  onCancel,
}: {
  item: UploadItem
  onRetry(key: string): void
  onCancel(key: string): void
}) {
  const { t, i18n } = useTranslation()
  const failed = item.status === 'error'
  const message = failed ? errorText(t, i18n, item.error) : t('react.uploading')
  return (
    <Attachment className={cn(chip, failed && 'border-destructive/60')} title={message}>
      <AttachmentMedia className="relative size-full rounded-none">
        <img
          src={item.url}
          alt=""
          className={cn('size-full object-cover', failed ? 'opacity-35 grayscale' : 'opacity-55')}
        />
      </AttachmentMedia>
      {failed ? (
        <AttachmentAction
          type="button"
          className="absolute inset-0 grid size-full place-items-center text-destructive focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          aria-label={t('react.retryUpload')}
          onClick={() => onRetry(item.key)}
        >
          <RotateCw size={18} strokeWidth={2.2} />
        </AttachmentAction>
      ) : (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <span className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        </span>
      )}
      <span className="sr-only">{failed ? t('react.uploadFailed') + ' ' + message : message}</span>
      <AttachmentAction
        type="button"
        className={corner}
        aria-label={t('react.cancelUpload')}
        onClick={() => onCancel(item.key)}
      >
        <X size={12} strokeWidth={2.5} />
      </AttachmentAction>
    </Attachment>
  )
}

/**
 * Reference thumbnails for a composer: committed references first, then uploads
 * that have not been committed yet, so one reference never renders two images.
 */
export function ReferenceTray({
  ids,
  items = [],
  previews,
  disabled = false,
  onRemove,
  onRetry,
  onCancel,
  className,
  children,
}: {
  ids: readonly string[]
  items?: readonly UploadItem[]
  previews?: ReadonlyMap<string, string>
  disabled?: boolean
  onRemove?: (id: string) => void
  onRetry?: (key: string) => void
  onCancel?: (key: string) => void
  className?: string
  children?: ReactNode
}) {
  if (!ids.length && !items.length && !children) return null
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {ids.map((id) => (
        <Committed
          key={id}
          id={id}
          preview={previews?.get(id)}
          disabled={disabled}
          onRemove={onRemove}
        />
      ))}
      {items.map((item) => (
        <Local
          key={item.key}
          item={item}
          onRetry={(key) => onRetry?.(key)}
          onCancel={(key) => onCancel?.(key)}
        />
      ))}
      {children}
    </div>
  )
}

/** Polite, non-alert summary of files skipped by type, size or slot limits. */
export function UploadNotice({
  notice,
  size,
  className,
}: {
  notice: Rejections | null
  size: string
  className?: string
}) {
  const { t } = useTranslation()
  const messages = notice
    ? [
        notice.type ? t('react.filesRejectedType', { count: notice.type }) : '',
        notice.size ? t('react.filesRejectedSize', { count: notice.size, size }) : '',
        notice.limit ? t('react.filesRejectedLimit', { count: notice.limit }) : '',
      ].filter(Boolean)
    : []
  return (
    <p
      aria-live="polite"
      className={cn('text-xs leading-5 text-warning', !messages.length && 'sr-only', className)}
    >
      {messages.join(' · ')}
    </p>
  )
}
