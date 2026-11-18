import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionService } from '../../../api/auth-session'
import { images, type ImageTask, type ImageConversation } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { createImageController, type ImageController } from './controller'

const row: ImageConversation = {
  id: 'c',
  title: 'image',
  model_id: 'model',
  pinned: false,
  version: 1,
  created_at: 'now',
  last_message_at: 'now',
}
const task: ImageTask = {
  id: 't',
  user_id: 'u',
  conversation_id: 'c',
  model_id: 'model',
  model_name: 'Model',
  prompt: 'prompt',
  operation: 'generate',
  quality: 'low',
  size: 'server-size',
  ratio: '',
  n: 2,
  reference_file_ids: [],
  unit_price: 7,
  total_cost: 14,
  refunded_cost: 0,
  actual_cost: 0,
  status: 'queued',
  successful_images: 0,
  queue_position: 1,
  cancel_requested: false,
  error_code: '',
  started_at: null,
  finished_at: null,
  created_at: 'now',
  version: 1,
  content_visible: true,
  items: [],
}
const input = {
  model_id: 'model',
  prompt: 'prompt',
  quality: 'low' as const,
  size: 'server-size',
  ratio: '',
  n: 2,
  reference_file_ids: [],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
let client: QueryClient,
  controller: ImageController,
  session: ReturnType<typeof createSessionService>
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  session = createSessionService()
  controller = createImageController(session, client)
  vi.spyOn(images, 'conversation').mockResolvedValue(row)
  vi.spyOn(images, 'tasks').mockResolvedValue({ items: [task], next_cursor: '' })
  vi.spyOn(images, 'events').mockImplementation(() => new Promise(() => undefined))
})
afterEach(() => {
  controller.dispose()
  client.clear()
  vi.useRealTimers()
})

describe('React image submission and subscription compatibility', () => {
  it('keeps the composer draft and replays the complete editor request after a lost response', async () => {
    await controller.open('c')
    controller.draft('c', { prompt: 'composer draft', references: ['other'] })
    const editor = {
      ...input,
      n: 1,
      reference_file_ids: ['source'],
      edit_options: { action: 'markup' as const, guide_file_id: 'guide' },
    }
    const submit = vi
      .spyOn(images, 'submit')
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValue({ ...task, ...editor, operation: 'edit' })
    await controller.submit('c', editor, 'editor')
    await controller.submit('c', { ...editor, prompt: 'new edit' }, 'editor')
    expect(submit).toHaveBeenCalledTimes(1)
    await controller.submit('c', undefined, 'editor')
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0])
    expect(controller.store.getState().drafts.c).toMatchObject({
      prompt: 'composer draft',
      references: ['other'],
    })
    await controller.regenerate({ ...task, ...editor, operation: 'edit' })
    expect(submit.mock.calls[2]?.[0]).toEqual(submit.mock.calls[0]?.[0])
    expect(submit.mock.calls[2]?.[1]).not.toBe(submit.mock.calls[0]?.[1])
  })
  it('replays the exact task body and key after a lost accepted response', async () => {
    const create = vi.spyOn(images, 'create').mockImplementation(async (id) => ({ ...row, id }))
    const submit = vi
      .spyOn(images, 'submit')
      .mockRejectedValueOnce(new Error('lost'))
      .mockRejectedValueOnce(new ApiError('RATE_LIMITED', 429))
      .mockImplementationOnce(async (body) => ({ ...task, conversation_id: body.conversation_id }))
    controller.draft('', { prompt: 'prompt' })
    await controller.submit('', input)
    const pending = controller.store.getState().pending.new
    expect(pending?.key).toBeTruthy()
    await controller.submit('', { ...input, prompt: 'changed', model_id: 'other' })
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0])
    expect(controller.store.getState().pending.new?.key).toBe(pending?.key)
    const conversationId = pending?.input.conversation_id ?? ''
    await controller.open(conversationId)
    await controller.submit(conversationId, { ...input, prompt: 'changed again' })
    expect(submit.mock.calls[2]).toEqual(submit.mock.calls[0])
    expect(create).toHaveBeenCalledTimes(1)
    expect(controller.store.getState().pending.new).toBeUndefined()
    expect(controller.snapshot(pending?.input.conversation_id ?? '')?.tasks).toHaveLength(1)
  })
  it('keeps the original creation identity and model when creation response is unknown', async () => {
    const create = vi
      .spyOn(images, 'create')
      .mockRejectedValueOnce(new Error('lost create'))
      .mockImplementationOnce(async (id) => ({ ...row, id }))
    vi.spyOn(images, 'submit').mockImplementation(async (body) => ({
      ...task,
      conversation_id: body.conversation_id,
    }))
    await controller.submit('', input)
    await controller.submit('', { ...input, model_id: 'other' })
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0])
  })
  it('only clears a definitively rejected request, preserving changed drafts after navigation', async () => {
    await controller.open('c')
    vi.spyOn(images, 'submit').mockRejectedValueOnce(new ApiError('INSUFFICIENT_CREDITS', 409))
    await controller.submit('c', input)
    expect(controller.store.getState().pending.c).toBeUndefined()
    const waiting = deferred<ImageTask>()
    vi.mocked(images.submit).mockReturnValueOnce(waiting.promise)
    controller.draft('c', { prompt: 'prompt' })
    const send = controller.submit('c', input)
    controller.activate('other')
    controller.draft('c', { prompt: 'replacement' })
    controller.draft('other', { prompt: 'other draft' })
    waiting.resolve(task)
    expect(await send).toBeUndefined()
    expect(controller.store.getState().active).toBe('other')
    expect(controller.store.getState().drafts.c?.prompt).toBe('replacement')
    expect(controller.store.getState().drafts.other?.prompt).toBe('other draft')
  })
  it('appends one independent task per accepted regeneration using the source parameters', async () => {
    const source: ImageTask = {
      ...task,
      status: 'running',
      operation: 'edit',
      ratio: '3:2',
      reference_file_ids: ['first-reference', 'second-reference'],
    }
    vi.mocked(images.tasks).mockResolvedValue({ items: [source], next_cursor: '' })
    const waiting = deferred<ImageTask>()
    const second = { ...source, id: 't2', status: 'queued' as const }
    const third = { ...second, id: 't3' }
    const submit = vi
      .spyOn(images, 'submit')
      .mockReturnValueOnce(waiting.promise)
      .mockResolvedValueOnce(third)
    const cancel = vi.spyOn(images, 'cancel')
    await controller.open('c')
    controller.draft('c', { prompt: source.prompt, references: source.reference_file_ids })
    const draft = controller.store.getState().drafts.c
    const first = controller.regenerate(source)
    await controller.regenerate(source)
    expect(submit).toHaveBeenCalledTimes(1)
    const body = {
      ...input,
      conversation_id: 'c',
      ratio: '3:2',
      reference_file_ids: source.reference_file_ids,
    }
    expect(submit).toHaveBeenNthCalledWith(1, body, expect.any(String))
    waiting.resolve(second)
    await first
    await controller.regenerate(source)
    expect(submit).toHaveBeenNthCalledWith(2, body, expect.any(String))
    expect(submit.mock.calls[1]?.[1]).not.toBe(submit.mock.calls[0]?.[1])
    expect(controller.snapshot('c')?.tasks).toEqual([source, second, third])
    expect(controller.store.getState().drafts.c).toBe(draft)
    expect(cancel).not.toHaveBeenCalled()
    expect(vi.mocked(images.events).mock.calls.map(([id]) => id)).toEqual(['t', 't2', 't3'])
  })
  it('replays an unconfirmed regeneration with the same key and preserves the draft', async () => {
    const submit = vi
      .spyOn(images, 'submit')
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ ...task, id: 't2' })
    await controller.open('c')
    controller.draft('c', { prompt: task.prompt, n: task.n })
    const draft = controller.store.getState().drafts.c
    await controller.regenerate(task)
    await controller.regenerate(task)
    expect(submit).toHaveBeenCalledTimes(1)
    await controller.submit('c')
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0])
    expect(controller.store.getState().pending.c).toBeUndefined()
    expect(controller.store.getState().drafts.c).toBe(draft)
    expect(controller.snapshot('c')?.tasks.map(({ id }) => id)).toEqual(['t', 't2'])
  })
  it('regenerates from an unrelated conversation into a new workspace with an exact retry', async () => {
    const edit = {
      ...task,
      operation: 'edit' as const,
      n: 1,
      reference_file_ids: ['reference'],
      edit_options: { action: 'erase' as const, guide_file_id: 'guide' },
    }
    const create = vi.spyOn(images, 'create').mockImplementation(async (id) => ({ ...row, id }))
    const submit = vi
      .spyOn(images, 'submit')
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR'))
      .mockImplementationOnce(async (body) => ({ ...edit, ...body, id: 'new-task' }))
    controller.draft('', { prompt: 'keep new draft' })
    const draft = controller.store.getState().drafts.new
    await Promise.all([controller.regenerateInto(edit, ''), controller.regenerateInto(edit, '')])
    expect(submit).toHaveBeenCalledTimes(1)
    const target = controller.store.getState().pending.new?.input.conversation_id ?? ''
    expect(target).not.toBe(edit.conversation_id)
    expect(submit.mock.calls[0]?.[0]).toEqual({
      ...input,
      conversation_id: target,
      n: 1,
      reference_file_ids: ['reference'],
      edit_options: edit.edit_options,
    })
    expect(await controller.submit('')).toBe(target)
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0])
    expect(create).toHaveBeenCalledTimes(1)
    expect(controller.snapshot(target)?.tasks.map(({ id }) => id)).toEqual(['new-task'])
    expect(controller.store.getState().drafts.new).toBe(draft)
  })
  it('preserves the source and draft when a regeneration is rejected or resolves after navigation', async () => {
    const rejection = new ApiError('INSUFFICIENT_CREDITS', 409)
    const waiting = deferred<ImageTask>()
    const submit = vi
      .spyOn(images, 'submit')
      .mockRejectedValueOnce(rejection)
      .mockReturnValueOnce(waiting.promise)
    await controller.open('c')
    controller.draft('c', { prompt: 'my draft' })
    await controller.regenerate(task)
    expect(controller.store.getState().errors.c).toBe(rejection)
    expect(controller.store.getState().pending.c).toBeUndefined()
    expect(controller.snapshot('c')?.tasks).toEqual([task])
    const next = controller.regenerate(task)
    expect(submit.mock.calls[1]?.[1]).not.toBe(submit.mock.calls[0]?.[1])
    controller.activate('other')
    controller.draft('other', { prompt: 'other draft' })
    waiting.resolve({ ...task, id: 't2' })
    await next
    expect(controller.store.getState().active).toBe('other')
    expect(controller.store.getState().drafts.c?.prompt).toBe('my draft')
    expect(controller.store.getState().drafts.other?.prompt).toBe('other draft')
    expect(controller.snapshot('c')?.tasks.map(({ id }) => id)).toEqual(['t', 't2'])
    expect(images.events).toHaveBeenCalledTimes(1)
  })
  it('ignores stale SSE versions and refreshes authoritative credits when a task settles', async () => {
    let event!: (row: ImageTask) => void
    vi.mocked(images.events).mockImplementation((_id, _signal, accept) => {
      event = accept
      return new Promise(() => undefined)
    })
    const invalidation = vi.spyOn(client, 'invalidateQueries')
    await controller.open('c')
    event({ ...task, version: 3, status: 'partial', actual_cost: 7, refunded_cost: 7 })
    event({ ...task, version: 2, status: 'running' })
    expect(controller.snapshot('c')?.tasks[0]).toMatchObject({
      status: 'partial',
      version: 3,
      actual_cost: 7,
      refunded_cost: 7,
    })
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['user', '', 'credits'] })
  })
  it('falls back to read-only polling and stops followers without canceling the task', async () => {
    vi.useFakeTimers()
    vi.mocked(images.events).mockRejectedValue(new Error('reader failed'))
    const poll = vi
      .spyOn(images, 'task')
      .mockResolvedValue({ ...task, version: 2, status: 'succeeded', actual_cost: 14 })
    const cancel = vi.spyOn(images, 'cancel')
    await controller.open('c')
    await vi.advanceTimersByTimeAsync(3000)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(controller.snapshot('c')?.tasks[0]?.status).toBe('succeeded')
    controller.stopFollowing()
    await vi.advanceTimersByTimeAsync(6000)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })
  it('does not resurrect deleted conversations or old-identity drafts from late responses', async () => {
    const pending = deferred<ImageTask>()
    vi.spyOn(images, 'submit').mockReturnValue(pending.promise)
    vi.spyOn(images, 'removeConversation').mockResolvedValue()
    await controller.open('c')
    const send = controller.submit('c', input)
    await controller.remove('c')
    pending.resolve(task)
    await send
    expect(controller.snapshot('c')).toBeUndefined()
    expect(controller.store.getState().pending.c).toBeUndefined()
    const next = deferred<ImageTask>()
    vi.mocked(images.submit).mockReturnValue(next.promise)
    await controller.open('other')
    const old = controller.submit('other', input)
    session.clear()
    controller.draft('', { prompt: 'new identity' })
    next.resolve({ ...task, conversation_id: 'other' })
    await old
    expect(controller.store.getState().drafts.new?.prompt).toBe('new identity')
    expect(controller.store.getState().pending).toEqual({})
  })
})
