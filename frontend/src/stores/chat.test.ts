import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { isCancelledError } from '@tanstack/react-query'
import { chats, type Conversation, type Message } from '../api/chat'
import { createAppRuntime, type AppRuntime } from '../react/app/runtime'
import { createSessionService } from '../api/auth-session'
const row: Conversation = {
  id: 'c',
  title: 'title',
  model_id: 'm',
  pinned: false,
  busy: false,
  version: 1,
  created_at: 'now',
  last_message_at: 'now',
}
const user: Message = {
  id: 'u',
  request_id: 'r',
  role: 'user',
  content: 'question',
  status: 'completed',
  model_id: 'm',
  meta: {},
  created_at: 'now',
}
const assistant: Message = { ...user, id: 'a', role: 'assistant', content: '', status: 'streaming' }

let runtime: AppRuntime
const historyKey = ['user', '', 'sidebar-history', 'chat']
const history = () =>
  runtime.queryClient.getQueryData<{ items: Conversation[] }>(historyKey)?.items ?? []
async function loadHistory() {
  try {
    await runtime.queryClient.fetchQuery({
      queryKey: historyKey,
      queryFn: ({ signal }) => chats.list(new URLSearchParams(), signal),
    })
  } catch (error) {
    if (!isCancelledError(error)) throw error
  }
}
beforeEach(() => {
  runtime = createAppRuntime(createSessionService())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
})
afterEach(() => {
  runtime.dispose()
  vi.restoreAllMocks()
})
describe('chat state isolation and streaming', () => {
  it('keeps a replayable request after a transport failure and reconciles persisted messages', async () => {
    vi.spyOn(chats, 'get').mockResolvedValue(row)
    vi.spyOn(chats, 'messages').mockResolvedValue({
      items: [{ ...assistant, content: 'saved', status: 'completed' }, user],
      next_cursor: '',
    })
    const send = vi
      .spyOn(chats, 'send')
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementationOnce(async (_id, _input, _signal, event) => {
        event({
          type: 'done',
          assistant: { ...assistant, content: 'saved', status: 'completed' },
          conversation: row,
        })
      })
    const store = runtime.chat
    await store.open('c')
    await store.send('c', { request_id: 'r', model_id: 'm', content: 'question', action: 'send' })
    expect(!!store.store.getState().pending.c).toBe(true)
    expect((store.snapshot('c')?.messages ?? []).at(-1)?.content).toBe('saved')
    await store.retryPending('c')
    expect(send.mock.calls[1]?.[1].request_id).toBe('r')
    expect(!!store.store.getState().pending.c).toBe(false)
  })
  it('does not replay an accepted regeneration or duplicate its user turn', async () => {
    vi.spyOn(chats, 'get').mockResolvedValue(row)
    vi.spyOn(chats, 'messages').mockResolvedValue({
      items: [{ ...assistant, content: 'new', status: 'completed' }, user],
      next_cursor: '',
    })
    vi.spyOn(chats, 'send').mockImplementation(async (_id, _input, _signal, event) => {
      event({ type: 'meta', user, assistant, conversation: row })
      event({ type: 'delta', content: 'new' })
      event({
        type: 'done',
        assistant: { ...assistant, content: 'new', status: 'completed' },
        conversation: row,
      })
    })
    const store = runtime.chat
    await store.open('c')
    await store.send('c', {
      request_id: 'r2',
      model_id: 'm',
      action: 'regenerate',
      content: '',
      last_message_id: 'u',
    })
    expect((store.snapshot('c')?.messages ?? []).map((m) => m.id)).toEqual(['u', 'a'])
    expect((store.snapshot('c')?.messages ?? []).at(-1)?.status).toBe('completed')
  })
  it('discards pending loads and drafts when the signed-in account changes', async () => {
    let resolve: ((value: { items: Conversation[]; next_cursor: string }) => void) | undefined
    vi.spyOn(chats, 'list').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const store = runtime.chat
    store.draft('', 'private draft')
    const pending = loadHistory()
    runtime.session.clear()
    resolve?.({ items: [row], next_cursor: '' })
    await pending
    expect(history()).toEqual([])
    expect(store.store.getState().drafts.new).toBeUndefined()
  })
  it('clears filtered-out history and ignores stream events arriving after deletion', async () => {
    const get = vi.spyOn(chats, 'get').mockResolvedValue(row)
    vi.spyOn(chats, 'messages').mockResolvedValue({ items: [user], next_cursor: '' })
    vi.spyOn(chats, 'list').mockResolvedValue({ items: [], next_cursor: '' })
    vi.spyOn(chats, 'delete').mockResolvedValue(undefined)
    let finish: (() => void) | undefined
    vi.spyOn(chats, 'send').mockImplementation(
      async (_id, _input, _signal, event) =>
        new Promise<void>((resolve) => {
          finish = () => {
            event({ type: 'delta', content: 'late content' })
            event({ type: 'done', assistant, conversation: row })
            resolve()
          }
        }),
    )
    const store = runtime.chat
    await store.open('c')
    store.draft('c', 'conversation draft')
    store.draft('', 'new draft')
    runtime.image.draft('image-draft', { prompt: 'image draft' })
    runtime.queryClient.setQueryData(historyKey, { items: [], next_cursor: '' })
    const pending = store.send('c', {
      request_id: 'r',
      model_id: 'm',
      content: 'question',
      action: 'send',
    })
    await store.remove([], true)
    finish?.()
    await pending
    expect(store.snapshot('c')?.messages ?? []).toEqual([])
    expect(history()).toEqual([])
    expect(store.store.getState().lastOpened).toBe('')
    expect(store.store.getState().drafts.c).toBeUndefined()
    expect(store.store.getState().drafts.new).toBe('new draft')
    expect(runtime.image.store.getState().drafts['image-draft']?.prompt).toBe('image draft')
    expect(store.store.getState().running.c).toBeUndefined()
    expect(store.store.getState().errors.c).toBeUndefined()
    expect(get).toHaveBeenCalledTimes(1)
  })
  it('ignores history mutations completed after the account session changes', async () => {
    let renamed: ((value: Conversation) => void) | undefined
    let removed: (() => void) | undefined
    vi.spyOn(chats, 'update').mockImplementation(
      async () =>
        new Promise<Conversation>((resolve) => {
          renamed = resolve
        }),
    )
    vi.spyOn(chats, 'delete').mockImplementation(
      async () =>
        new Promise<void>((resolve) => {
          removed = resolve
        }),
    )
    const list = vi.spyOn(chats, 'list')
    const store = runtime.chat
    const changes = Promise.all([store.update(row, 'renamed'), store.remove([], true)])
    store.reset()
    store.draft('', 'next account draft')
    renamed?.({ ...row, title: 'renamed' })
    removed?.()
    await changes
    expect(history()).toEqual([])
    expect(store.store.getState().drafts.new).toBe('next account draft')
    expect(list).not.toHaveBeenCalled()
  })
})
