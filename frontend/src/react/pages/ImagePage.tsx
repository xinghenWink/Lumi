import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from 'zustand'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { images, terminal, type ImageFile, type ImageTask } from '../../api/images'
import { ApiError } from '../../api/transport'
import { useImageController } from '../features/images/use-image-controller'
import { useRuntime } from '../app/context'
import { useModels } from '../features/catalog/models'
import { imageSubmissionScope } from '../features/images/controller'
import { addExistingReference } from '../features/images/references'
import { emptyTaskFilters, taskFilterQuery } from '../features/images/task-filters'
import { useMediaQuery } from '../lib/media'
import { ModeTabs } from '../components/chat/ModeTabs'
import { ImageComposer } from '../components/images/ImageComposer'
import { ImageConversationActions } from '../components/images/ImageConversationActions'
import { ImageWorkspaceTools } from '../components/images/ImageWorkspaceTools'
import { PageStatus } from '../components/shared/PageStatus'
import { ApiNotice } from '../components/shared/ApiNotice'
import { ImageGenerationIcon } from '../components/shared/ImageGenerationIcon'
import { Button } from '../components/ui/button'

const ImageAssetPanel = lazy(() => import('../components/images/ImageAssetPanel'))
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
  const { id = '' } = useParams()
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
  return <ImageWorkspace key={id} id={id} />
}

function ImageWorkspace({ id }: { id: string }) {
  const runtime = useRuntime(),
    { t } = useTranslation()
  const image = useImageController(),
    models = useModels('image'),
    data = useQuery(image.options(id))
  // Desktop is a studio with a persistent parameter panel; smaller screens dock the composer.
  const wide = useMediaQuery('(min-width: 1024px)')
  const dockAssets = useMediaQuery('(min-width: 1440px)')
  const assetsTrigger = useRef<HTMLButtonElement>(null)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState(emptyTaskFilters)
  const criteria = taskFilterQuery(keyword, filters)
  const results = useInfiniteQuery({
    queryKey: [...image.filteredKey(id), criteria],
    enabled: !!id && !!criteria && data.isSuccess,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(criteria)
      params.set('conversation_id', id)
      params.set('limit', '50')
      if (pageParam) params.set('cursor', pageParam)
      return images.tasks(params, signal)
    },
    getNextPageParam: (page) => page.next_cursor || undefined,
    refetchInterval: (query) => {
      // The controller follows live tasks from the unfiltered history.
      const followed = new Set(data.data?.tasks.map((task) => task.id))
      const needsRefresh = query.state.data?.pages.some((page) =>
        page.items.some((task) => !terminal(task.status) && !followed.has(task.id)),
      )
      return needsRefresh ? 3000 : false
    },
  })
  const available = models.query.data?.items,
    modelID = data.data?.conversation.model_id
  const initializedModel = useRef<string | null>(null)
  const restoredModel = useStore(image.store, (state) => state.restoredModel)
  const older = useMutation({ mutationFn: () => image.loadOlder(id) })
  const submitting = useStore(
    image.store,
    (state) => !!state.sending[imageSubmissionScope(state, id)],
  )
  const submitLocked = useStore(
    image.store,
    (state) => !!state.pending[imageSubmissionScope(state, id)],
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
        if (!models.items.some((model) => model.id === value.task.model_id))
          throw new ApiError('IMAGE_MODEL_UNAVAILABLE')
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
        initializedModel.current = id
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
          outputFormat: value.task.output_format,
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
    // Submission refreshes the saved conversation model. Seed the composer only when opening it.
    if (restoredModel?.conversationId === id && available) {
      initializedModel.current = id
      if (available.some((model) => model.id === restoredModel.modelId))
        runtime.modelStore.getState().select('image', restoredModel.modelId)
      image.clearRestoredModel()
      return
    }
    if (
      initializedModel.current !== id &&
      modelID &&
      available?.some((model) => model.id === modelID)
    ) {
      initializedModel.current = id
      runtime.modelStore.getState().select('image', modelID)
    }
  }, [runtime, image, id, modelID, available, restoredModel])
  const mutate = action.mutate,
    refetch = data.refetch
  const cancel = useCallback((task: ImageTask) => image.cancel(task), [image])
  const edit = useCallback((file: ImageFile) => mutate({ kind: 'edit', file }), [mutate])
  const reuse = useCallback((task: ImageTask) => mutate({ kind: 'reuse', task }), [mutate])
  const regenerate = useCallback(
    (task: ImageTask) => {
      void image.regenerate(task)
    },
    [image],
  )
  const changed = useCallback(() => {
    image.refreshHistory(id)
  }, [image, id])
  function closeAssets() {
    setAssetsOpen(false)
    requestAnimationFrame(() => assetsTrigger.current?.focus({ preventScroll: true }))
  }
  function suggest(prompt: string) {
    image.draft(id, { prompt })
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLTextAreaElement>('.image-composer textarea')
      field?.focus()
      field?.setSelectionRange(prompt.length, prompt.length)
    })
  }
  const composer = !id || !data.isError
  const tasks = criteria
    ? (results.data?.pages.flatMap((page) => page.items).reverse() ?? [])
    : (data.data?.tasks ?? [])
  const historyError = criteria ? (results.data ? results.error : undefined) : older.error
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {wide && composer ? (
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-sidebar/45 xl:w-[360px]">
          <ImageComposer key={id || 'new'} conversationId={id} layout="panel" />
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-1 sm:gap-x-3 sm:px-6">
          <ModeTabs />
          <div className="ml-auto flex items-center gap-1">
            <ImageWorkspaceTools
              disabled={!data.data}
              search={keyword}
              filters={filters}
              assetsOpen={assetsOpen}
              assetsDialog={!dockAssets}
              assetsTrigger={assetsTrigger}
              onSearch={setKeyword}
              onFilter={setFilters}
              onAssetsToggle={() => (assetsOpen ? closeAssets() : setAssetsOpen(true))}
            />
            {data.data ? (
              <div className="flex min-w-0 items-center gap-1">
                <span className="hidden max-w-40 truncate px-1.5 text-xs text-muted-foreground sm:block xl:max-w-52">
                  {data.data.conversation.title || t('images.untitled')}
                </span>
                <ImageConversationActions row={data.data.conversation} />
              </div>
            ) : null}
          </div>
        </div>
        {criteria ? (
          <div
            className="mx-auto flex w-full max-w-5xl shrink-0 items-center gap-2 px-4 py-1 text-xs text-muted-foreground sm:px-6"
            aria-live="polite"
          >
            {keyword ? (
              <span className="min-w-0 truncate" title={keyword}>
                {t('images.searchActive', { keyword })}
              </span>
            ) : null}
            {keyword ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setKeyword('')}>
                {t('images.clearSearch')}
              </Button>
            ) : null}
            {Object.values(filters).some(Boolean) ? (
              <span className="shrink-0">{t('images.filterActive')}</span>
            ) : null}
          </div>
        ) : null}
        {action.error || historyError ? (
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <ApiNotice error={action.error || historyError} />
          </div>
        ) : null}
        {id && data.isPending ? (
          <PageStatus />
        ) : id && data.isError ? (
          <PageStatus error={data.error} retry={() => void refetch()} />
        ) : criteria && !results.data ? (
          <PageStatus error={results.error} retry={() => void results.refetch()} />
        ) : tasks.length ? (
          <Suspense fallback={<PageStatus />}>
            <ImageTaskList
              key={criteria}
              tasks={tasks}
              older={criteria ? !!results.hasNextPage : !!data.data?.nextCursor}
              loading={criteria ? results.isFetching : older.isPending}
              submitting={!criteria && submitting}
              onOlder={async () => {
                if (criteria) await results.fetchNextPage()
                else await older.mutateAsync().catch(() => undefined)
              }}
              onCancel={cancel}
              onReuse={reuse}
              onRegenerate={regenerate}
              reuseDisabled={submitLocked || action.isPending || models.query.isPending}
              regenerateDisabled={submitLocked || action.isPending}
              onEdit={edit}
              onChanged={changed}
            />
          </Suspense>
        ) : criteria ? (
          <p
            role="status"
            className="grid flex-1 place-content-center px-4 text-sm text-muted-foreground"
          >
            {t('images.noMatchingTasks')}
          </p>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-5 py-8 text-center">
            <ImageGenerationIcon size={128} className="mb-5 animate-rise-in" />
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
      {assetsOpen ? (
        <Suspense
          fallback={
            dockAssets ? (
              <aside className="flex w-[360px] shrink-0 border-l border-border">
                <PageStatus />
              </aside>
            ) : null
          }
        >
          <ImageAssetPanel
            docked={dockAssets}
            onClose={closeAssets}
            conversationId={id}
            onWorkspace={(kind) => {
              if (kind === 'regenerate') {
                setKeyword('')
                setFilters(emptyTaskFilters)
                closeAssets()
              } else {
                setAssetsOpen(false)
                requestAnimationFrame(() => {
                  document.querySelector<HTMLTextAreaElement>('.image-composer textarea')?.focus()
                })
              }
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
