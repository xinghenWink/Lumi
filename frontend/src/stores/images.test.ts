import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { images, type ImageTask } from '../api/images'
import { credits } from '../api/credits'
import { ApiError } from '../api/transport'
import { useImageStore } from './images'
import { useModelStore } from './models'
import { useAuthStore } from './auth'
import { conversation, task } from '../features/images/test-fixtures'
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(credits, 'account').mockResolvedValue({
    user_id: 'owner',
    permanent_balance: 100,
    daily_balance: 0,
    total: 100,
    daily_reset_on: '',
    next_reset_at: '',
    timezone: 'UTC',
    version: 1,
  })
})
afterEach(() => {
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
    vi.spyOn(images, 'conversations').mockResolvedValue({ items: [conversation], next_cursor: '' })
    const store = useImageStore()
    store.active = conversation.id
    useModelStore().selected.image = 'model'
    store.draft.prompt = 'earlier prompt'
    const pending = store.submit()
    await store.open('')
    store.draft.prompt = 'new private draft'
    resolve?.(task)
    expect(await pending).toBeUndefined()
    expect(store.active).toBe('')
    expect(store.draft.prompt).toBe('new private draft')
    expect(store.tasks).toEqual([])
  })
  it('keeps the exact submission key and payload after an unknown response', async () => {
    vi.spyOn(images, 'create').mockResolvedValue(conversation)
    vi.spyOn(images, 'conversation').mockResolvedValue(conversation)
    vi.spyOn(images, 'tasks').mockResolvedValue({ items: [task], next_cursor: '' })
    vi.spyOn(images, 'conversations').mockResolvedValue({ items: [conversation], next_cursor: '' })
    const submit = vi
      .spyOn(images, 'submit')
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR'))
      .mockResolvedValueOnce(task)
    const store = useImageStore()
    useModelStore().selected.image = 'model'
    store.draft.prompt = '星空'
    await store.submit()
    expect(store.pending).toBeTruthy()
    store.draft.prompt = 'changed locally'
    await store.submit()
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0])
    expect(store.pending).toBeUndefined()
    expect(store.tasks.map((t) => t.id)).toEqual(['task'])
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
    const store = useImageStore()
    store.draft.prompt = 'private'
    const pending = store.list()
    useAuthStore().user = {
      id: 'other',
      email: 'other@example.test',
      nickname: 'Other',
      role: 'user',
      status: 'active',
      locale: 'zh-CN',
      timezone: 'UTC',
      created_at: 'now',
      last_login_at: null,
      last_login_ip: '',
    }
    resolve?.({ items: [conversation], next_cursor: '' })
    await pending
    expect(store.conversations).toEqual([])
    expect(Object.keys(store.drafts)).toEqual([])
    expect(store.pending).toBeUndefined()
  })
  it('falls back to polling after a subscription failure without canceling the task', async () => {
    vi.useFakeTimers()
    vi.spyOn(images, 'conversation').mockResolvedValue(conversation)
    vi.spyOn(images, 'tasks').mockResolvedValue({
      items: [{ ...task, status: 'running' }],
      next_cursor: '',
    })
    vi.spyOn(images, 'events').mockRejectedValue(new ApiError('NETWORK_ERROR'))
    const poll = vi.spyOn(images, 'task').mockResolvedValue(task)
    const cancel = vi.spyOn(images, 'cancel')
    const store = useImageStore()
    await store.open(conversation.id)
    await vi.advanceTimersByTimeAsync(3000)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(store.tasks[0]?.status).toBe('succeeded')
    store.stopFollowing()
    expect(cancel).not.toHaveBeenCalled()
  })
  it('ignores delayed events from a previous conversation', async () => {
    vi.spyOn(images, 'conversation').mockResolvedValue(conversation)
    vi.spyOn(images, 'tasks').mockResolvedValue({
      items: [{ ...task, status: 'running' }],
      next_cursor: '',
    })
    let event: ((task: ImageTask) => void) | undefined
    vi.spyOn(images, 'events').mockImplementation(async (_id, _signal, onTask) => {
      event = onTask
    })
    const store = useImageStore()
    await store.open(conversation.id)
    await store.open('')
    event?.(task)
    expect(store.tasks).toEqual([])
  })
})
