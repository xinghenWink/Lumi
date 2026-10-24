import { lazy, Suspense, useCallback, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { images, type ImageFile, type ImageTask } from '../../api/images'
import { ApiError } from '../../api/transport'
import { useRuntime } from '../app/context'
import { useModels } from '../features/catalog/models'
import { emptyImageDraft, imageSubmissionScope } from '../features/images/controller'
import { ModeTabs } from '../components/chat/ModeTabs'
import { ImageComposer } from '../components/images/ImageComposer'
import { ImageConversationActions } from '../components/images/ImageConversationActions'
import { PageStatus } from '../components/shared/PageStatus'
import { ApiNotice } from '../components/shared/ApiNotice'
const ImageTaskList = lazy(() =>
  import('../components/images/ImageTaskList').then((module) => ({
    default: module.ImageTaskList,
  })),
)

export default function ImagePage() {
  const { id = '' } = useParams(),
    runtime = useRuntime(),
    { t } = useTranslation()
  const image = runtime.image,
    models = useModels('image'),
    data = useQuery(image.options(id))
  const available = models.query.data?.items,
    modelID = data.data?.conversation.model_id
  const older = useMutation({ mutationFn: () => image.loadOlder(id) })
  const action = useMutation({
    mutationFn: async (
      value: { kind: 'edit'; file: ImageFile } | { kind: 'reuse'; task: ImageTask },
    ) => {
      const owner = runtime.session.getSnapshot().user?.id,
        epoch = runtime.session.snapshot().epoch
      if (value.kind === 'edit') {
        const candidate = models.selected?.capabilities.supports_edit
          ? models.selected
          : models.items.find((model) => model.capabilities.supports_edit)
        const configuration = await images.options()
        if (!candidate || !configuration) throw new ApiError('IMAGE_REFERENCE_INVALID')
        if (value.file.size > configuration.max_upload_bytes) throw new ApiError('FILE_TOO_LARGE')
        if (
          owner !== runtime.session.getSnapshot().user?.id ||
          epoch !== runtime.session.snapshot().epoch ||
          id !== image.store.getState().active
        )
          return
        const draft = image.store.getState().drafts[id || 'new'] ?? emptyImageDraft
        if (draft.references.includes(value.file.id)) return
        if (
          draft.references.length >=
          Math.min(configuration.max_references, candidate.capabilities.max_reference_images)
        )
          throw new ApiError('IMAGE_REFERENCE_INVALID')
        if (image.store.getState().pending[imageSubmissionScope(image.store.getState(), id)])
          throw new ApiError('INVALID_INPUT')
        models.select(candidate.id)
        runtime.queryClient.setQueryData(['user', owner, 'file', value.file.id], value.file)
        image.draft(id, { references: [...draft.references, value.file.id] })
      } else {
        const results = await Promise.allSettled(
          value.task.reference_file_ids.map((reference) => images.file(reference)),
        )
        if (
          owner !== runtime.session.getSnapshot().user?.id ||
          epoch !== runtime.session.snapshot().epoch ||
          id !== image.store.getState().active
        )
          return
        if (image.store.getState().pending[imageSubmissionScope(image.store.getState(), id)])
          throw new ApiError('INVALID_INPUT')
        models.select(value.task.model_id)
        const references = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )
        for (const file of references)
          runtime.queryClient.setQueryData(['user', owner, 'file', file.id], file)
        image.draft(id, {
          prompt: value.task.prompt,
          quality: value.task.quality,
          size: value.task.size,
          ratio: value.task.ratio,
          n: value.task.n,
          references: references.map((file) => file.id),
        })
        if (references.length !== results.length) throw new ApiError('IMAGE_REFERENCE_INVALID')
      }
    },
  })
  useEffect(() => {
    void image.open(id)
    return () => image.stopFollowing()
  }, [image, id])
  useEffect(() => {
    if (modelID && available?.some((model) => model.id === modelID))
      runtime.modelStore.getState().select('image', modelID)
  }, [runtime, modelID, available])
  const mutate = action.mutate,
    refetch = data.refetch
  const cancel = useCallback((task: ImageTask) => image.cancel(task), [image])
  const edit = useCallback((file: ImageFile) => mutate({ kind: 'edit', file }), [mutate])
  const reuse = useCallback((task: ImageTask) => mutate({ kind: 'reuse', task }), [mutate])
  const changed = useCallback(() => {
    void refetch()
  }, [refetch])
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <ModeTabs />
        {data.data ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {data.data.conversation.title || t('images.untitled')}
            </span>
            <ImageConversationActions row={data.data.conversation} />
          </div>
        ) : null}
      </div>
      <ApiNotice error={action.error || older.error} />
      {id && data.isPending ? (
        <PageStatus />
      ) : id && data.isError ? (
        <PageStatus error={data.error} retry={changed} />
      ) : data.data?.tasks.length ? (
        <Suspense fallback={<PageStatus />}>
          <ImageTaskList
            key={id}
            tasks={data.data.tasks}
            older={!!data.data.nextCursor}
            loading={older.isPending}
            onOlder={() => older.mutateAsync().catch(() => undefined)}
            onCancel={cancel}
            onReuse={reuse}
            onEdit={edit}
            onChanged={changed}
          />
        </Suspense>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-5 py-8 text-center">
          <span className="mb-2 grid size-14 place-items-center rounded-2xl bg-accent text-primary">
            <Sparkles size={28} strokeWidth={1.5} />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('images.title')}</h1>
          <p className="max-w-md text-sm leading-7 text-muted-foreground">
            {t('images.description')}
          </p>
        </section>
      )}
      {!id || !data.isError ? <ImageComposer key={id || 'new'} conversationId={id} /> : null}
    </div>
  )
}
