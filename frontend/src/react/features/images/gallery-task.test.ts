import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionService } from '../../../api/auth-session'
import { catalog } from '../../../api/catalog'
import { defaultCapabilities } from '../../../api/catalog-contracts'
import { images, type ImageConfiguration, type ImageFile } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { conversation, task } from '../../../features/images/test-fixtures'
import { createAppRuntime } from '../../app/runtime'
import type { ImageController } from './controller'
import { restoreGalleryTask } from './gallery-task'

const configuration: ImageConfiguration = {
  max_n: 3,
  max_references: 3,
  max_upload_bytes: 1024,
  sizes: ['1024x1024', '1536x1024', 'auto'],
  ratio_sizes: { '16:9': '1536x1024' },
  resolution_presets: [{ ratio: '3:2', resolution: '1k', size: '1536x1024' }],
  per_user_concurrency: 1,
  global_concurrency: 2,
  timeout_seconds: 30,
  queue_timeout_seconds: 60,
  split_requests: false,
  retention_days: 0,
  admin_can_view_content: false,
  version: 1,
}
const file = (id: string): ImageFile => ({
  id,
  kind: 'upload',
  mime: 'image/png',
  size: 100,
  width: 10,
  height: 10,
  thumbnail_width: 10,
  thumbnail_height: 10,
  url: '',
  thumbnail_url: '',
  expires_at: 0,
  created_at: task.created_at,
})
const edit = {
  ...task,
  operation: 'edit',
  size: '1536x1024',
  ratio: '16:9',
  n: 2,
  reference_file_ids: ['second', 'first'],
} as const

let runtime: ReturnType<typeof createAppRuntime>, image: ImageController
beforeEach(async () => {
  runtime = createAppRuntime(createSessionService())
  image = await runtime.loadImage()
  vi.spyOn(images, 'options').mockResolvedValue(configuration)
  vi.spyOn(images, 'conversation').mockImplementation(async (id) => ({ ...conversation, id }))
  vi.spyOn(images, 'file').mockImplementation(async (id) => file(id))
  vi.spyOn(images, 'quote').mockResolvedValue({ unit_price: 10, total_cost: 20, count: 2 })
  vi.spyOn(catalog, 'public').mockResolvedValue({
    items: [
      {
        id: task.model_id,
        type: 'image',
        display_name: 'Historical model',
        description: '',
        icon: '',
        is_default: false,
        sort_order: 0,
        capabilities: {
          ...defaultCapabilities('image'),
          supports_edit: true,
          sizes: configuration.sizes,
          qualities: ['medium'],
          max_n: 3,
          max_reference_images: 3,
        },
      },
    ],
  })
})
afterEach(() => runtime.dispose())

function restore(
  source = task,
  conversationId = 'destination',
  signal = new AbortController().signal,
) {
  return restoreGalleryTask({
    runtime,
    image,
    task: source,
    conversationId,
    expectedDraft: image.store.getState().drafts[conversationId || 'new'],
    signal,
  })
}

describe('restoring an owned gallery task', () => {
  it('restores exact legacy parameters and ordered reference IDs into the destination', async () => {
    image.draft(task.conversation_id, { prompt: 'original draft' })
    const source = { ...edit, reference_file_ids: [...edit.reference_file_ids] }
    expect(await restore(source)).toBe(true)
    expect(image.store.getState().drafts.destination).toEqual({
      prompt: task.prompt,
      quality: 'medium',
      size: edit.size,
      ratio: edit.ratio,
      n: edit.n,
      references: edit.reference_file_ids,
    })
    expect(image.store.getState().drafts[task.conversation_id]?.prompt).toBe('original draft')
    expect(image.store.getState().restoredModel).toEqual({
      conversationId: 'destination',
      modelId: task.model_id,
    })
    expect(runtime.queryClient.getQueryData(['user', undefined, 'file', 'first'])).toEqual(
      file('first'),
    )
  })

  it('fills a blank conversation with no reference images and leaves creation for submission', async () => {
    expect(await restore(task, '')).toBe(true)
    expect(image.store.getState().drafts.new).toMatchObject({ prompt: task.prompt, references: [] })
    expect(images.conversation).not.toHaveBeenCalled()
    expect(images.file).not.toHaveBeenCalled()
  })

  it('restores legacy automatic tasks as the auto ratio option', async () => {
    expect(await restore({ ...task, size: 'auto', ratio: '' })).toBe(true)
    expect(image.store.getState().drafts.destination).toMatchObject({ size: 'auto', ratio: 'auto' })
    expect(images.quote).toHaveBeenCalledWith(
      expect.objectContaining({ size: 'auto' }),
      expect.anything(),
    )
  })

  it('keeps the destination draft when a reference or historical setting is unavailable', async () => {
    image.draft('destination', { prompt: 'keep this draft' })
    const draft = image.store.getState().drafts.destination
    vi.mocked(images.file).mockRejectedValueOnce(new ApiError('FILE_NOT_FOUND', 404))
    await expect(
      restore({ ...edit, reference_file_ids: [...edit.reference_file_ids] }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await expect(restore({ ...task, n: 4 })).rejects.toMatchObject({
      code: 'IMAGE_HISTORY_PARAMETERS_UNAVAILABLE',
    })
    expect(image.store.getState().drafts.destination).toBe(draft)
    expect(image.store.getState().restoredModel).toBeNull()
  })

  it('rechecks the draft and route before applying the validated input', async () => {
    const restoring = restore(task)
    image.draft('destination', { prompt: 'updated while checking' })
    await expect(restoring).rejects.toMatchObject({ code: 'IMAGE_DRAFT_CHANGED' })
    const controller = new AbortController()
    const leaving = restore(task, 'destination', controller.signal)
    controller.abort()
    expect(await leaving).toBe(false)
    expect(image.store.getState().drafts.destination?.prompt).toBe('updated while checking')
  })
})
