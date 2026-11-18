import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Pencil, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { images } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { imageSubmissionScope, type ImageDraft } from '../../features/images/controller'
import { restoreGalleryTask } from '../../features/images/gallery-task'
import { taskParameters } from '../../features/images/presentation'
import { ApiNotice } from '../shared/ApiNotice'
import { PageStatus } from '../shared/PageStatus'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { ImageTaskDetails } from './ImageTaskDetails'

export type GalleryTaskAction = 'edit' | 'regenerate'

interface Confirmation {
  kind: GalleryTaskAction
  destination: string
  previousDraft: ImageDraft | undefined
  replacesDraft: boolean
}

export function GalleryTaskDetails({
  taskId,
  conversationId,
  editorDirty,
  returnFocus,
  onClose,
  onWorkspace,
}: {
  taskId: string
  conversationId?: string
  editorDirty: boolean
  returnFocus: RefObject<HTMLButtonElement | null>
  onClose(): void
  onWorkspace(kind: GalleryTaskAction): void
}) {
  const { t } = useTranslation()
  const runtime = useRuntime()
  const { user } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const view = useRef<AbortController | null>(null)
  const running = useRef(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const regenerateButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const query = useQuery({
    queryKey: ['user', user?.id, 'image-task-details', taskId],
    enabled: !!user,
    queryFn: ({ signal }) => images.task(taskId, false, signal),
    staleTime: 0,
  })
  const task = query.isError ? undefined : query.data
  const parameters = task ? taskParameters(task, t) : ''
  useEffect(() => {
    const controller = new AbortController()
    view.current = controller
    return () => controller.abort()
  }, [location.key])
  const action = useMutation({
    mutationFn: async ({
      kind,
      confirmed,
    }: {
      kind: GalleryTaskAction
      confirmed?: Confirmation
    }) => {
      const signal = view.current?.signal
      const { user, epoch } = runtime.session.getSnapshot()
      const current = () => {
        const now = runtime.session.getSnapshot()
        return !signal?.aborted && now.user?.id === user?.id && now.epoch === epoch
      }
      if (!signal || !user || !task?.content_visible || !task.prompt.trim()) return
      const image = await runtime.loadImage()
      if (!current()) return
      const state = image.store.getState()
      const destination = conversationId ?? state.active
      const scope = imageSubmissionScope(state, destination)
      if (state.pending[scope]) throw new ApiError('IMAGE_SUBMISSION_PENDING')
      const previousDraft = state.drafts[destination || 'new']
      const replacesDraft =
        kind === 'edit' && !!(previousDraft?.prompt || previousDraft?.references.length)
      if (!confirmed && (replacesDraft || editorDirty)) {
        setConfirmation({ kind, destination, previousDraft, replacesDraft })
        return
      }
      setConfirmation(null)
      if (
        confirmed &&
        (confirmed.destination !== destination ||
          (kind === 'edit' && confirmed.previousDraft !== previousDraft))
      )
        throw new ApiError('IMAGE_DRAFT_CHANGED')

      let target = destination
      if (kind === 'edit') {
        const restored = await restoreGalleryTask({
          runtime,
          image,
          task,
          conversationId: destination,
          expectedDraft: previousDraft,
          signal,
        })
        if (!restored || !current()) return
      } else {
        const result = await image.regenerateInto(task, destination)
        if (!current()) return
        const updated = image.store.getState()
        if (result) target = result
        else if (!updated.pending[scope]) {
          if (updated.errors[scope]) throw updated.errors[scope]
          return
        }
        // Keep the existing composer model when returning from the standalone gallery.
        const modelId = runtime.modelStore.getState().selected.image
        if (conversationId === undefined && destination && modelId && previousDraft)
          image.preferRestoredModel(destination, modelId)
      }
      onWorkspace(kind)
      const path = target ? '/create/' + encodeURIComponent(target) : '/create'
      if (location.pathname !== path) await navigate(path)
    },
  })
  useEffect(() => {
    if (confirmation && !action.isPending) cancelButton.current?.focus({ preventScroll: true })
  }, [confirmation, action.isPending])

  function run(kind: GalleryTaskAction, confirmed?: Confirmation) {
    if (running.current) return
    running.current = true
    void action
      .mutateAsync({ kind, ...(confirmed ? { confirmed } : {}) })
      .catch(() => undefined)
      .finally(() => {
        running.current = false
      })
  }

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('images.details')}
      description={parameters}
      returnFocus={returnFocus}
      busy={action.isPending}
      className="flex flex-col overflow-hidden [&_[data-slot=dialog-description]]:shrink-0 [&_[data-slot=dialog-description]:empty]:hidden"
      overlayClassName="z-60"
    >
      {task ? (
        <div
          role="region"
          aria-label={t('images.details')}
          tabIndex={0}
          className="min-h-0 overflow-y-auto overscroll-contain focus-visible:-outline-offset-2"
        >
          <ImageTaskDetails task={task} showInput />
        </div>
      ) : (
        <PageStatus error={query.error} retry={() => void query.refetch()} />
      )}
      {task?.content_visible && task.prompt.trim() ? (
        <div className="mt-4 flex shrink-0 flex-col gap-3 border-t border-border pt-4">
          <ApiNotice error={action.error} />
          {confirmation ? (
            <div role="status" className="text-sm text-muted-foreground">
              {confirmation.replacesDraft ? <p>{t('images.replaceHistoryDraft')}</p> : null}
              {editorDirty ? <p>{t('images.editor.discardDescription')}</p> : null}
            </div>
          ) : null}
          {action.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            {confirmation ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  ref={cancelButton}
                  className="min-h-11 px-2 sm:min-h-0 sm:px-4"
                  disabled={action.isPending}
                  onClick={() => {
                    const trigger = confirmation.kind === 'edit' ? editButton : regenerateButton
                    setConfirmation(null)
                    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  className="min-h-11 px-2 sm:min-h-0 sm:px-4"
                  disabled={action.isPending}
                  onClick={() => run(confirmation.kind, confirmation)}
                >
                  {t('images.confirmHistoryReuse')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  ref={editButton}
                  className="min-h-11 px-2 sm:min-h-0 sm:px-4"
                  disabled={action.isPending || query.isFetching}
                  onClick={() => run('edit')}
                >
                  <Pencil aria-hidden="true" size={16} />
                  {t('images.reedit')}
                </Button>
                <Button
                  type="button"
                  ref={regenerateButton}
                  className="min-h-11 px-2 sm:min-h-0 sm:px-4"
                  disabled={action.isPending || query.isFetching}
                  onClick={() => run('regenerate')}
                >
                  <RotateCcw aria-hidden="true" size={16} />
                  {t('images.regenerate')}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </ModalDialog>
  )
}
