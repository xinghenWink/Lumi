import { catalog } from '../../../api/catalog'
import { images, type ImageTask } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import type { AppRuntime } from '../../app/runtime'
import { imageSubmissionScope, type ImageController, type ImageDraft } from './controller'
import { resolveImageOptions } from './options'

export async function restoreGalleryTask({
  runtime,
  image,
  task,
  conversationId,
  expectedDraft,
  signal,
}: {
  runtime: AppRuntime
  image: ImageController
  task: ImageTask
  conversationId: string
  expectedDraft: ImageDraft | undefined
  signal: AbortSignal
}) {
  const { user, epoch } = runtime.session.getSnapshot()
  const sameSession = () => {
    const now = runtime.session.getSnapshot()
    return !signal.aborted && now.user?.id === user?.id && now.epoch === epoch
  }
  const draftKey = conversationId || 'new'
  function checkDraft() {
    const state = image.store.getState()
    if (state.pending[imageSubmissionScope(state, conversationId)])
      throw new ApiError('IMAGE_SUBMISSION_PENDING')
    if (state.drafts[draftKey] !== expectedDraft) throw new ApiError('IMAGE_DRAFT_CHANGED')
  }
  if (!sameSession()) return false
  checkDraft()
  const client = runtime.queryClient
  const [configuration, models, files] = await Promise.all([
    client.fetchQuery({
      queryKey: ['user', user?.id, 'image-options'],
      queryFn: ({ signal }) => images.options(false, signal),
      staleTime: 0,
    }),
    client.fetchQuery({
      queryKey: ['user', user?.id, 'models', 'image'],
      queryFn: ({ signal }) => catalog.public('image', signal),
      staleTime: 0,
    }),
    Promise.all(
      task.reference_file_ids.map(async (id) => {
        const file = await images.file(id, signal)
        if (file.id !== id || !['upload', 'generated'].includes(file.kind))
          throw new ApiError('IMAGE_REFERENCE_INVALID')
        return file
      }),
    ),
    conversationId ? images.conversation(conversationId, signal) : undefined,
  ])
  if (!sameSession()) return false
  const model = models.items.find((model) => model.type === 'image' && model.id === task.model_id)
  if (!model) throw new ApiError('IMAGE_MODEL_UNAVAILABLE')
  const draft = {
    prompt: task.prompt,
    quality: task.quality,
    size: task.size,
    ratio: task.ratio || (task.size === 'auto' ? 'auto' : ''),
    n: task.n,
    references: files.map((file) => file.id),
  } satisfies ImageDraft
  const options = resolveImageOptions(draft, configuration, model)
  if (
    options.quality !== draft.quality ||
    options.size !== draft.size ||
    options.ratio !== draft.ratio ||
    options.n !== draft.n
  )
    throw new ApiError('IMAGE_HISTORY_PARAMETERS_UNAVAILABLE')
  if (files.length > options.maxReferences) throw new ApiError('IMAGE_REFERENCES_INVALID')
  if (files.some((file) => file.size > configuration.max_upload_bytes))
    throw new ApiError('FILE_TOO_LARGE')

  const operation = files.length ? 'edit' : 'generate'
  await client.fetchQuery({
    queryKey: [
      'user',
      user?.id,
      'image-quote',
      task.model_id,
      operation,
      task.quality,
      task.size,
      task.n,
    ],
    queryFn: ({ signal }) =>
      images.quote(
        {
          model_id: task.model_id,
          operation,
          quality: task.quality,
          size: task.size,
          count: task.n,
        },
        signal,
      ),
    staleTime: 0,
    retry: false,
  })
  if (!sameSession()) return false
  checkDraft()
  for (const file of files) client.setQueryData(['user', user?.id, 'file', file.id], file)
  image.restoreDraft(conversationId, draft, task.model_id)
  return true
}
