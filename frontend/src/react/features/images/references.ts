import { images, type ImageFile } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import type { AppRuntime } from '../../app/runtime'
import type { useModels } from '../catalog/models'
import { pickEditModel, referenceCapacity, referenceProblem } from '../files/reference-rules'

/**
 * Adds an already stored image (a result, a gallery item or a library pick) to an
 * image draft. Replaces three copies of the same validation in ImagePage, the
 * gallery and the composer; the order of checks is unchanged.
 *
 * Resolves `false` when the session or active conversation changed meanwhile.
 */
export async function addExistingReference(
  runtime: AppRuntime,
  models: ReturnType<typeof useModels>,
  file: ImageFile,
  conversationId: string,
  { requireActive = false }: { requireActive?: boolean } = {},
): Promise<boolean> {
  const owner = runtime.session.getSnapshot().user?.id,
    epoch = runtime.session.snapshot().epoch
  const candidate = pickEditModel(models.selected, models.items)
  const [configuration, image, { emptyImageDraft, imageSubmissionScope }] = await Promise.all([
    images.options(),
    runtime.loadImage(),
    import('./controller'),
  ])
  if (!candidate) throw new ApiError('IMAGE_REFERENCE_INVALID')
  if (file.size > configuration.max_upload_bytes) throw new ApiError('FILE_TOO_LARGE')
  if (
    owner !== runtime.session.getSnapshot().user?.id ||
    epoch !== runtime.session.snapshot().epoch ||
    (requireActive && conversationId !== image.store.getState().active)
  )
    return false
  const state = image.store.getState()
  const draft = state.drafts[conversationId || 'new'] ?? emptyImageDraft
  const problem = referenceProblem(
    file,
    draft.references,
    referenceCapacity(configuration, candidate),
    configuration.max_upload_bytes,
  )
  if (problem === 'duplicate') return true
  if (problem) throw new ApiError(problem === 'size' ? 'FILE_TOO_LARGE' : 'IMAGE_REFERENCE_INVALID')
  if (state.pending[imageSubmissionScope(state, conversationId)])
    throw new ApiError('INVALID_INPUT')
  models.select(candidate.id)
  runtime.queryClient.setQueryData(['user', owner, 'file', file.id], file)
  image.draft(conversationId, { references: [...draft.references, file.id] })
  return true
}
