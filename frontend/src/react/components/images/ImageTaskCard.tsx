import { memo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Copy,
  Download,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { images, terminal, type ImageFile, type ImageTask } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useImageActions } from '../../features/images/actions'
import { elapsedSeconds, statusTone, taskAspect } from '../../features/images/presentation'
import { useTime } from '../../features/accounts/time'
import { useNow } from '../../lib/ticker'
import { cn } from '../../lib/utils'
import { ApiNotice } from '../shared/ApiNotice'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { ProtectedImage } from './ProtectedImage'
import { ImagePreview } from './ImagePreview'
import { ImageTaskPrompt } from './ImageTaskPrompt'
import { ReferenceChips } from './ReferenceChips'

const tones = {
  active: 'bg-accent text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
} as const

const grids: Record<number, string> = {
  1: 'max-w-md grid-cols-1',
  2: 'max-w-3xl grid-cols-2',
  3: 'max-w-4xl grid-cols-2 sm:grid-cols-3',
  4: 'max-w-4xl grid-cols-2 xl:grid-cols-4',
}

function Elapsed({ task }: { task: ImageTask }) {
  const { t } = useTranslation()
  const live = !terminal(task.status)
  const now = useNow(live)
  if (!live && !task.started_at) return null
  return (
    <span className="tabular-nums">
      {t('react.elapsed', { seconds: elapsedSeconds(task, now) })}
    </span>
  )
}

export const ImageTaskCard = memo(function ImageTaskCard({
  task,
  admin = false,
  onCancel,
  onReuse,
  onRegenerate,
  reuseDisabled = false,
  regenerateDisabled = false,
  onEdit,
  onChanged,
}: {
  task: ImageTask
  admin?: boolean
  onCancel?: (task: ImageTask) => Promise<void>
  onReuse?: (task: ImageTask) => void
  onRegenerate?: (task: ImageTask) => void
  reuseDisabled?: boolean
  regenerateDisabled?: boolean
  onEdit?: (file: ImageFile) => void
  onChanged(): void
}) {
  const { t } = useTranslation(),
    time = useTime(),
    actions = useImageActions()
  const [preview, setPreview] = useState<number | null>(null),
    [details, setDetails] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null)
  const detailsTrigger = useRef<HTMLButtonElement>(null)
  const previewTrigger = useRef<HTMLButtonElement>(null)
  const files = task.items.flatMap((item) => (item.file ? [item.file] : []))
  // One ratio per task keeps result tiles in a row the same height, including failed slots.
  const aspect = taskAspect(task, files[0])
  const tone = statusTone(task.status)
  const done = terminal(task.status)
  const canReuse = !admin && task.content_visible
  const editor =
    canReuse && onEdit
      ? {
          conversationId: task.conversation_id,
          modelId: task.model_id,
          quality: task.quality,
          size: task.size,
          ratio: task.ratio,
        }
      : undefined
  const parameters = [
    task.model_name,
    t('images.' + task.quality),
    task.size,
    task.ratio,
    t('react.imageCount', { count: task.n }),
  ]
    .filter(Boolean)
    .join(' · ')
  const removal = useMutation({
    mutationFn: async () => {
      if (deleting) await images.removeFile(deleting, admin)
    },
    onSuccess: () => {
      setDeleting(null)
      onChanged()
    },
  })
  const cancellation = useMutation({
    mutationFn: async () => {
      await onCancel?.(task)
    },
  })
  const action =
    'size-7 rounded-lg text-foreground hover:bg-foreground/10 focus-visible:outline-offset-0'
  const references =
    task.content_visible && task.reference_file_ids.length ? (
      <ReferenceChips
        ids={task.reference_file_ids}
        className="image-task-references justify-end"
        previewable={!admin}
        {...(editor ? { editor } : {})}
      />
    ) : null

  function taskActions(variant: 'ghost' | 'outline') {
    return (
      <>
        {canReuse && (variant === 'outline' || done) && onReuse ? (
          <Button
            type="button"
            variant={variant}
            size="sm"
            disabled={reuseDisabled}
            onClick={() => onReuse(task)}
          >
            <SlidersHorizontal size={13} />
            {t('images.reuseParameters')}
          </Button>
        ) : null}
        {canReuse && variant === 'outline' && onRegenerate ? (
          <Button
            type="button"
            variant={variant}
            size="sm"
            disabled={regenerateDisabled}
            onClick={() => onRegenerate(task)}
          >
            <RotateCcw size={13} />
            {t('images.regenerate')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={variant}
          size="sm"
          aria-haspopup="dialog"
          onClick={(event) => {
            detailsTrigger.current = event.currentTarget
            setDetails(true)
          }}
        >
          <Info size={13} />
          {t('images.details')}
        </Button>
      </>
    )
  }

  return (
    <article
      className="image-task @container/image-task border-b border-border py-6 last:border-0"
      data-task-id={task.id}
    >
      <header
        className={cn(
          'mb-4 gap-3',
          admin
            ? 'flex items-start'
            : 'grid @min-[38rem]/image-task:grid-cols-[minmax(0,1fr)_18rem]',
        )}
      >
        <div className="min-w-0 flex-1">
          {!admin && task.content_visible && task.prompt ? (
            <ImageTaskPrompt prompt={task.prompt} />
          ) : (
            <p className="text-sm leading-6 break-words whitespace-pre-wrap">
              {task.content_visible ? task.prompt : t('images.hidden')}
            </p>
          )}
          <p className="mt-1 text-2xs text-muted-foreground">{parameters}</p>
        </div>
        {admin ? (
          references
        ) : (
          <div className="flex min-w-0 flex-col items-end gap-2">
            {references}
            <div
              data-testid="image-task-top-actions"
              className="flex flex-wrap justify-end gap-1.5"
            >
              {taskActions('outline')}
            </div>
          </div>
        )}
      </header>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium',
            tones[tone],
          )}
        >
          <span
            aria-hidden="true"
            className={cn('size-1.5 rounded-full bg-current', tone === 'active' && 'animate-pulse')}
          />
          <span className="image-status" role="status">
            {t('images.' + task.status)}
          </span>
        </span>
        {task.status === 'queued' ? (
          <span>{t('images.queue', { position: task.queue_position })}</span>
        ) : null}
        <Elapsed task={task} />
        <span className="tabular-nums">
          {t(done ? 'images.actual' : 'images.reserved', {
            cost: done ? task.actual_cost : task.total_cost,
          })}
        </span>
        {task.refunded_cost ? (
          <span className="tabular-nums">{t('images.refund', { cost: task.refunded_cost })}</span>
        ) : null}
      </div>
      {task.content_visible ? (
        <div className={cn('grid gap-2.5', grids[Math.min(4, Math.max(1, task.n))])}>
          {task.items.map((item) => (
            <div
              key={item.position}
              className="group relative grid place-items-center overflow-hidden rounded-2xl border border-border bg-muted"
              style={{ aspectRatio: aspect }}
            >
              {item.file ? (
                <>
                  <ProtectedImage
                    file={item.file}
                    alt={t('images.result', { index: item.position + 1 })}
                    className="size-full object-cover animate-fade-in"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="absolute inset-0 size-full cursor-zoom-in rounded-none p-0 hover:bg-transparent focus-visible:-outline-offset-2"
                    aria-label={t('images.preview') + ' ' + (item.position + 1)}
                    onClick={(event) => {
                      previewTrigger.current = event.currentTarget
                      setPreview(files.findIndex((file) => file.id === item.file?.id))
                    }}
                  />
                  <div className="image-result-actions reveal-on-hover absolute top-2 right-2 flex items-center gap-0.5 rounded-xl bg-background/85 p-0.5 shadow-sm backdrop-blur">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={action}
                      aria-label={t('images.download')}
                      title={t('images.download')}
                      onClick={() => {
                        if (item.file) void actions.download(item.file)
                      }}
                    >
                      <Download size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={action}
                      aria-label={t('images.copy')}
                      title={t('images.copy')}
                      onClick={() => {
                        if (item.file) void actions.copy(item.file)
                      }}
                    >
                      <Copy size={14} />
                    </Button>
                    {!admin && onEdit ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={action}
                        aria-label={t('images.edit')}
                        title={t('images.edit')}
                        onClick={() => {
                          if (item.file) onEdit(item.file)
                        }}
                      >
                        <Plus size={15} />
                      </Button>
                    ) : null}
                    {editor ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={action}
                        aria-label={t('images.editor.open')}
                        title={t('images.editor.open')}
                        onClick={(event) => {
                          previewTrigger.current = event.currentTarget
                          setPreview(files.findIndex((file) => file.id === item.file?.id))
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={action}
                      aria-label={t('images.delete')}
                      title={t('images.delete')}
                      onClick={() => {
                        removal.reset()
                        setDeleting(item.file?.id ?? null)
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </>
              ) : item.status === 'pending' ? (
                <span className="lumi-shimmer absolute inset-0">
                  <span className="sr-only">{t('images.pending')}</span>
                </span>
              ) : (
                <span className="px-3 text-center text-xs text-muted-foreground">
                  {t(item.status === 'succeeded' ? 'images.fileMissing' : 'images.failed')}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : admin ? (
        <div className="flex flex-wrap gap-2">
          {task.items.map((item) =>
            item.file_id ? (
              <Button
                key={item.position}
                variant="outline"
                size="sm"
                aria-label={t('images.delete') + ' ' + (item.position + 1)}
                onClick={() => {
                  removal.reset()
                  setDeleting(item.file_id)
                }}
              >
                <Trash2 size={14} />
                {t('images.result', { index: item.position + 1 })}
              </Button>
            ) : null,
          )}
        </div>
      ) : null}
      {task.error_code ? (
        <div className="mt-3">
          <ApiNotice error={new ApiError(task.error_code)} />
        </div>
      ) : null}
      {actions.error || cancellation.error ? (
        <div className="mt-3">
          <ApiNotice error={actions.error || cancellation.error} />
        </div>
      ) : null}
      {actions.copied ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {t('images.copied')}
        </p>
      ) : null}
      <div className="mt-3 -ml-2 flex flex-wrap gap-0.5">
        {!admin && !done && onCancel ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={task.cancel_requested || cancellation.isPending}
            onClick={() => cancellation.mutate()}
          >
            <X size={13} />
            {t(task.cancel_requested ? 'images.cancelRequested' : 'images.cancel')}
          </Button>
        ) : null}
        {taskActions('ghost')}
      </div>
      {preview !== null ? (
        <ImagePreview
          files={files}
          initialIndex={preview}
          prompt={task.prompt}
          parameters={parameters}
          onClose={() => setPreview(null)}
          returnFocus={previewTrigger}
          {...(editor ? { editor } : {})}
          {...(!admin && onEdit ? { onEdit } : {})}
        />
      ) : null}
      <ModalDialog
        open={details}
        onOpenChange={setDetails}
        title={t('images.details')}
        description={parameters}
        returnFocus={detailsTrigger}
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
          {[
            ['images.task', task.id],
            ['images.user', task.user_id],
            ['images.created', time(task.created_at)],
            [
              'images.operation',
              t(task.operation === 'edit' ? 'images.editOperation' : 'images.generate'),
            ],
            ['images.status', t('images.' + task.status)],
          ].map(([label, value]) => (
            <div className="contents" key={label}>
              <dt className="text-muted-foreground">{t(label ?? '')}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs tabular-nums">
          {t('images.actual', { cost: task.actual_cost })} ·{' '}
          {t('images.refund', { cost: task.refunded_cost })}
        </p>
        {task.started_at && task.finished_at ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('images.duration', {
              seconds: Math.max(
                0,
                (Date.parse(task.finished_at) - Date.parse(task.started_at)) / 1000,
              ).toFixed(1),
            })}
          </p>
        ) : null}
      </ModalDialog>
      <ModalDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={t('images.deleteTitle')}
        description={t('images.deleteHint')}
        busy={removal.isPending}
      >
        <ApiNotice error={removal.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={removal.isPending} onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={removal.isPending}
            onClick={() => removal.mutate()}
          >
            {t('common.delete')}
          </Button>
        </div>
      </ModalDialog>
    </article>
  )
})
