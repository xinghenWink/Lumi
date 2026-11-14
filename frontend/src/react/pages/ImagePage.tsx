import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from 'zustand'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { images, type ImageFile, type ImageTask } from '../../api/images'
import { ApiError } from '../../api/transport'
import { useImageController } from '../features/images/use-image-controller'
import { useRuntime } from '../app/context'
import { useModels } from '../features/catalog/models'
import { imageSubmissionScope } from '../features/images/controller'
import { addExistingReference } from '../features/images/references'
import { useMediaQuery } from '../lib/media'
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

const suggestions = [
  'react.imageSuggestions.landscape',
  'react.imageSuggestions.product',
  'react.imageSuggestions.portrait',
  'react.imageSuggestions.illustration',
] as const

export default function ImagePage() {
  const runtime = useRuntime()
  const [error, setError] = useState<unknown>()
  const [image, setImage] = useState(() => runtime.imageController)
  useEffect(() => {
    if (image || error) return
    let active = true
    void runtime.loadImage().then(
      (controller) => {
        if (active) setImage(controller)
      },
      (failure: unknown) => {
        if (active) setError(failure)
      },
    )
    return () => {
      active = false
    }
  }, [error, image, runtime])
  if (!image) return <PageStatus error={error} retry={() => setError(undefined)} />
  return <ImageWorkspace />
}

function ImageWorkspace() {
  const { id = '' } = useParams(),
    runtime = useRuntime(),
    { t } = useTranslation()
  const image = useImageController(),
    models = useModels('image'),
    data = useQuery(image.options(id))
  // Desktop is a studio with a persistent parameter panel; smaller screens dock the composer.
  const wide = useMediaQuery('(min-width: 1024px)')
  const available = models.query.data?.items,
    modelID = data.data?.conversation.model_id
  const older = useMutation({ mutationFn: () => image.loadOlder(id) })
  const submitting = useStore(
    image.store,
    (state) => !!state.sending[imageSubmissionScope(state, id)],
  )
  const action = useMutation({
    mutationFn: async (
      value: { kind: 'edit'; file: ImageFile } | { kind: 'reuse'; task: ImageTask },
    ) => {
      const owner = runtime.session.getSnapshot().user?.id,
        epoch = runtime.session.snapshot().epoch
      if (value.kind === 'edit') {
        await addExistingReference(runtime, models, value.file, id, { requireActive: true })
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
  function suggest(prompt: string) {
    image.draft(id, { prompt })
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLTextAreaElement>('.image-composer textarea')
      field?.focus()
      field?.setSelectionRange(prompt.length, prompt.length)
    })
  }
  const composer = !id || !data.isError
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {wide && composer ? (
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-sidebar/45 xl:w-[360px]">
          <ImageComposer key={id || 'new'} conversationId={id} layout="panel" />
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-3 sm:px-6">
          <ModeTabs />
          {data.data ? (
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-xs text-muted-foreground">
                {data.data.conversation.title || t('images.untitled')}
              </span>
              <ImageConversationActions row={data.data.conversation} />
            </div>
          ) : null}
        </div>
        {action.error || older.error ? (
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <ApiNotice error={action.error || older.error} />
          </div>
        ) : null}
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
              submitting={submitting}
              onOlder={() => older.mutateAsync().catch(() => undefined)}
              onCancel={cancel}
              onReuse={reuse}
              onEdit={edit}
              onChanged={changed}
            />
          </Suspense>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8 text-center">
            <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-accent text-primary animate-rise-in">
              <Sparkles size={24} strokeWidth={1.6} />
            </span>
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-[32px]">
              {t('images.title')}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              {t(wide ? 'react.imageEmptyHint' : 'images.description')}
            </p>
            {composer ? (
              <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {suggestions.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="rounded-xl border border-border bg-card px-3.5 py-3 text-left text-xs leading-5 text-muted-foreground shadow-xs transition-[border-color,color] hover:border-input hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => suggest(t(key))}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        )}
        {!wide && composer ? (
          <ImageComposer key={id || 'new'} conversationId={id} layout="dock" />
        ) : null}
      </div>
    </div>
  )
}
