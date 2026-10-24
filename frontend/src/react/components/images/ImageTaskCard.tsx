import { memo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, Download, Info, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { images, terminal, type ImageFile, type ImageTask } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useImageActions } from '../../features/images/actions'
import { useTime } from '../../features/accounts/time'
import { ApiNotice } from '../shared/ApiNotice'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { ProtectedImage } from './ProtectedImage'
import { ImagePreview } from './ImagePreview'
import { ReferenceChips } from './ReferenceChips'

export const ImageTaskCard = memo(function ImageTaskCard({
  task,
  admin = false,
  onCancel,
  onReuse,
  onEdit,
  onChanged,
}: {
  task: ImageTask
  admin?: boolean
  onCancel?: (task: ImageTask) => Promise<void>
  onReuse?: (task: ImageTask) => void
  onEdit?: (file: ImageFile) => void
  onChanged(): void
}) {
  const { t } = useTranslation(),
    time = useTime(),
    actions = useImageActions()
  const [preview, setPreview] = useState<number | null>(null),
    [details, setDetails] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null)
  const files = task.items.flatMap((item) => (item.file ? [item.file] : []))
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
  return (
    <article className="image-task py-5" data-task-id={task.id}>
      <div className="mb-5 ml-auto w-fit max-w-[92%] rounded-2xl rounded-tr-sm bg-accent px-4 py-3 text-sm leading-7">
        <p className="whitespace-pre-wrap break-words">
          {task.content_visible ? task.prompt : t('images.hidden')}
        </p>
        <p className="mt-2 text-[10px] leading-5 text-muted-foreground">{parameters}</p>
        {task.content_visible && task.reference_file_ids.length ? (
          <ReferenceChips ids={task.reference_file_ids} className="image-task-references" />
        ) : null}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="image-status rounded-md bg-muted px-2 py-1 text-foreground" role="status">
          {t('images.' + task.status)}
        </span>
        {task.status === 'queued' ? (
          <span>{t('images.queue', { position: task.queue_position })}</span>
        ) : null}
        <span>
          {t(terminal(task.status) ? 'images.actual' : 'images.reserved', {
            cost: terminal(task.status) ? task.actual_cost : task.total_cost,
          })}
        </span>
        {task.refunded_cost ? (
          <span>{t('images.refund', { cost: task.refunded_cost })}</span>
        ) : null}
        {!admin && !terminal(task.status) && onCancel ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={task.cancel_requested || cancellation.isPending}
            onClick={() => cancellation.mutate()}
          >
            {t(task.cancel_requested ? 'images.cancelRequested' : 'images.cancel')}
          </Button>
        ) : null}
      </div>
      {task.content_visible ? (
        <div
          className={`grid gap-3 ${task.n === 1 ? 'max-w-lg grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}
        >
          {task.items.map((item) => (
            <div
              key={item.position}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              {item.file ? (
                <>
                  <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                    <ProtectedImage
                      file={item.file}
                      alt={t('images.result', { index: item.position + 1 })}
                      className="size-full object-contain"
                    />
                    <button
                      type="button"
                      className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      aria-label={t('images.preview') + ' ' + (item.position + 1)}
                      onClick={() =>
                        setPreview(files.findIndex((file) => file.id === item.file?.id))
                      }
                    />
                  </div>
                  <div className="image-result-actions flex items-center justify-end gap-1 p-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('images.download')}
                      onClick={() => {
                        if (item.file) void actions.download(item.file)
                      }}
                    >
                      <Download size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('images.copy')}
                      onClick={() => {
                        if (item.file) void actions.copy(item.file)
                      }}
                    >
                      <Copy size={15} />
                    </Button>
                    {!admin && onEdit ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={t('images.edit')}
                        onClick={() => {
                          if (item.file) onEdit(item.file)
                        }}
                      >
                        <Plus size={15} />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('images.delete')}
                      onClick={() => {
                        removal.reset()
                        setDeleting(item.file?.id ?? null)
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </>
              ) : (
                <div
                  role="status"
                  className={`grid aspect-[4/3] place-items-center bg-muted px-4 text-xs text-muted-foreground ${item.status === 'pending' ? 'animate-pulse' : ''}`}
                >
                  {t(
                    item.status === 'pending'
                      ? 'images.pending'
                      : item.status === 'succeeded'
                        ? 'images.fileMissing'
                        : 'images.failed',
                  )}
                </div>
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
      <ApiNotice error={task.error_code ? new ApiError(task.error_code) : null} />
      <ApiNotice error={actions.error || cancellation.error} />
      {actions.copied ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {t('images.copied')}
        </p>
      ) : null}
      <div className="mt-3 flex gap-1">
        {!admin && terminal(task.status) && onReuse ? (
          <Button variant="ghost" size="sm" onClick={() => onReuse(task)}>
            <RotateCcw size={13} />
            {t('images.regenerate')}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setDetails(true)}>
          <Info size={13} />
          {t('images.details')}
        </Button>
      </div>
      {preview !== null ? (
        <ImagePreview
          files={files}
          initialIndex={preview}
          prompt={task.prompt}
          parameters={parameters}
          onClose={() => setPreview(null)}
          {...(!admin && onEdit ? { onEdit } : {})}
        />
      ) : null}
      <ModalDialog
        open={details}
        onOpenChange={setDetails}
        title={t('images.details')}
        description={parameters}
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
        <p className="mt-4 text-xs">
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
        <div className="flex justify-end gap-2">
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
