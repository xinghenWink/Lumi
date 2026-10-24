import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { isCancelledError } from '@tanstack/react-query'
import { images, type ImageTask } from '../api/images'
import { ApiError } from '../api/transport'
import { createAppRuntime, type AppRuntime } from '../react/app/runtime'
import { createSessionService } from '../api/auth-session'
import { conversation, task } from '../features/images/test-fixtures'

let runtime: AppRuntime
const historyKey = ['user', '', 'sidebar-history', 'image']
const input = (prompt: string) => ({
  model_id: 'model',
  prompt,
  quality: task.quality,
  size: task.size,
  ratio: task.ratio,
  n: task.n,
  reference_file_ids: [],
})
beforeEach(() => {
  runtime = createAppRuntime(createSessionService())
})
afterEach(() => {
  runtime.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('image request replay and account isolation', () => {
  it('leaves a newly selected conversation in place when an earlier submission finishes', async () => {
    let resolve: ((value: ImageTask) => void) | undefined
    vi.spyOn(images, 'submit').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const store = runtime.image
    store.activate(conversation.id)
    store.draft(conversation.id, { prompt: 'earlier prompt' })
    const pending = store.submit(conversation.id, input('earlier prompt'))
    await store.open('')
    store.draft('', { prompt: 'new private draft' })
    resolve?.(task)
    expect(await pending).toBeUndefined()
    expect(store.store.getState().active).toBe('')
    expect(store.store.getState().drafts.new?.prompt).toBe('new private draft')
    expect(store.snapshot('')?.tasks ?? []).toEqual([])
  })
  it('keeps the exact submission key and payload after an unknown response', async () => {
    vi.spyOn(images, 'create').mockImplementation(async (id) => ({ ...conversation, id }))
    const submit = vi
      .spyOn(images, 'submit')
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR'))
      .mockImplementationOnce(async (body) => ({ ...task, conversation_id: body.conversation_id }))
    const store = runtime.image
    store.draft('', { prompt: '星空' })
    await store.submit('', input('星空'))
    expect(store.store.getState().pending.new).toBeTruthy()
    store.draft('', { prompt: 'changed locally' })
    await store.submit('', input('changed locally'))
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0])
    expect(store.store.getState().pending.new).toBeUndefined()
    expect(store.snapshot(store.store.getState().active)?.tasks.map((value) => value.id)).toEqual([
      'task',
    ])
  })
  it('discards loads and private drafts after an account change', async () => {
    let resolve:
      ((value: { items: (typeof conversation)[]; next_cursor: string }) => void) | undefined
    vi.spyOn(images, 'conversations').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const store = runtime.image
    store.draft('', { prompt: 'private' })
    const pending = runtime.queryClient
      .fetchQuery({
        queryKey: historyKey,
        queryFn: ({ signal }) => images.conversations(new URLSearchParams(), signal),
      })
      .catch((error: unknown) => {
        if (!isCancelledError(error)) throw error
      })
    runtime.session.clear()
    resolve?.({ items: [conversation], next_cursor: '' })
    await pending
    expect(runtime.queryClient.getQueryData(historyKey)).toBeUndefined()
    expect(Object.keys(store.store.getState().drafts)).toEqual([])
    expect(store.store.getState().pending).toEqual({})
  })
  it('falls back to polling after a subscription failure without canceling the task', async () => {
    vi.useFakeTimers()
    vi.spyOn(images, 'conversation').mockResolvedValue(conversation)
    vi.spyOn(images, 'tasks').mockResolvedValue({
      items: [{ ...task, status: 'running' }],
      next_cursor: '',
    })
    vi.spyOn(images, 'events').mockRejectedValue(new ApiError('NETWORK_ERROR'))
    const poll = vi.spyOn(images, 'task').mockResolvedValue({ ...task, version: task.version + 1 }),
      cancel = vi.spyOn(images, 'cancel'),
      store = runtime.image
    await store.open(conversation.id)
    await vi.advanceTimersByTimeAsync(3000)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(store.snapshot(conversation.id)?.tasks[0]?.status).toBe('succeeded')
    store.stopFollowing()
    expect(cancel).not.toHaveBeenCalled()
  })
  it('ignores delayed events from a previous conversation', async () => {
    vi.spyOn(images, 'conversation').mockResolvedValue(conversation)
    vi.spyOn(images, 'tasks').mockResolvedValue({
      items: [{ ...task, status: 'running' }],
      next_cursor: '',
    })
    let event: ((value: ImageTask) => void) | undefined
    vi.spyOn(images, 'events').mockImplementation(async (_id, _signal, onTask) => {
      event = onTask
    })
    const store = runtime.image
    await store.open(conversation.id)
    await store.open('')
    event?.(task)
    expect(store.snapshot(store.store.getState().active)?.tasks ?? []).toEqual([])
    expect(store.snapshot(conversation.id)?.tasks[0]?.status).toBe('running')
  })
})
