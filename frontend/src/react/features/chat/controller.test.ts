import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chats, type ChatEvent, type Conversation, type Message } from '../../../api/chat'
import { createSessionService } from '../../../api/auth-session'
import { createChatController, type ChatController } from './controller'

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
const input = { request_id: 'r', model_id: 'm', content: 'question', action: 'send' as const }
const completed = { ...assistant, content: 'saved', status: 'completed' as const }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
let client: QueryClient, chat: ChatController, session: ReturnType<typeof createSessionService>
let frames: Map<number, FrameRequestCallback>, frameID: number
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  session = createSessionService()
  chat = createChatController(session, client)
  frames = new Map()
  frameID = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameID, callback)
    return frameID
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(chats, 'get').mockResolvedValue(row)
  vi.spyOn(chats, 'messages').mockResolvedValue({ items: [completed, user], next_cursor: '' })
})
afterEach(() => {
  chat.dispose()
  client.clear()
})

describe('React chat controller compatibility', () => {
  it('retains the original request and reconciles durable messages after a transport failure', async () => {
    const send = vi
      .spyOn(chats, 'send')
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async (_id, _body, _signal, event) => {
        event({ type: 'done', assistant: completed, conversation: row })
      })
    await chat.open('c')
    await chat.send('c', input)
    expect(chat.store.getState().pending.c).toEqual(input)
    expect(chat.snapshot('c')?.messages.at(-1)?.content).toBe('saved')
    await chat.retryPending('c')
    expect(send.mock.calls[1]?.[1]).toEqual(input)
    expect(chat.store.getState().pending.c).toBeUndefined()
  })

  it('uses the same creation ID and payload when the server accepted an unknown response', async () => {
    const create = vi
      .spyOn(chats, 'create')
      .mockRejectedValueOnce(new Error('response lost'))
      .mockImplementationOnce(async (id, model) => ({ ...row, id, model_id: model }))
    await expect(chat.create('first-model')).rejects.toThrow('response lost')
    const id = await chat.create('changed-model')
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0])
    expect(chat.snapshot(id)?.conversation.model_id).toBe('first-model')
    expect(chat.store.getState().lastOpened).toBe(id)
  })

  it('regenerates one assistant turn and edits the last user without duplicates', async () => {
    await chat.open('c')
    const old: Message = { ...user, id: 'older-user' }
    client.setQueryData(chat.options('c').queryKey, {
      conversation: row,
      messages: [old, user, completed],
      nextCursor: '',
    })
    vi.spyOn(chats, 'send').mockImplementation(async (_id, body, _signal, event) => {
      event({
        type: 'meta',
        conversation: row,
        user: body.action === 'edit' ? { ...user, id: 'edited-user', content: 'edited' } : user,
        assistant,
      })
      event({ type: 'delta', content: 'new' })
      expect(
        chat
          .snapshot('c')
          ?.messages.filter((item) => item.role === 'user')
          .map((item) => item.id),
      ).toEqual(body.action === 'edit' ? ['older-user', 'edited-user'] : ['older-user', 'u'])
      event({ type: 'done', conversation: row, assistant: completed })
    })
    await chat.send('c', {
      ...input,
      request_id: 'regenerate',
      action: 'regenerate',
      last_message_id: 'u',
    })
    client.setQueryData(chat.options('c').queryKey, {
      conversation: row,
      messages: [old, user, completed],
      nextCursor: '',
    })
    await chat.send('c', {
      ...input,
      request_id: 'edit',
      action: 'edit',
      last_message_id: 'u',
      content: 'edited',
    })
    expect(chat.store.getState().pending.c).toBeUndefined()
  })

  it('sends an explicit stop while leaving the active SSE reader connected', async () => {
    const finish = deferred<undefined>()
    let signal: AbortSignal | undefined
    vi.spyOn(chats, 'send').mockImplementation(async (_id, _body, current, event) => {
      signal = current
      event({ type: 'meta', conversation: row, user, assistant })
      await finish.promise
      event({ type: 'done', conversation: row, assistant: completed })
    })
    const stop = vi.spyOn(chats, 'stop').mockResolvedValue(undefined)
    await chat.open('c')
    const sending = chat.send('c', input)
    await chat.stop('c')
    expect(stop).toHaveBeenCalledWith('c')
    expect(signal?.aborted).toBe(false)
    expect(chat.store.getState().running.c).toBe(true)
    finish.resolve(undefined)
    await sending
    expect(chat.store.getState().running.c).toBe(false)
  })

  it('resumes a durable running checkpoint through GET replay with the original request ID', async () => {
    const finish = deferred<undefined>()
    const send = vi.spyOn(chats, 'send').mockImplementation(async (_id, _body, _signal, event) => {
      await finish.promise
      event({ type: 'done', conversation: row, assistant: completed })
    })
    vi.mocked(chats.get).mockResolvedValueOnce({ ...row, busy: true })
    vi.mocked(chats.messages).mockResolvedValueOnce({ items: [assistant, user], next_cursor: '' })
    await chat.open('c')
    expect(send.mock.calls[0]?.[1].request_id).toBe('r')
    expect(send.mock.calls[0]?.[4]).toBe(true)
    finish.resolve(undefined)
    await vi.waitFor(() => expect(chat.store.getState().running.c).toBe(false))
  })

  it('clears filtered-out cached conversations and rejects late stream events after deletion', async () => {
    const finish = deferred<undefined>()
    vi.spyOn(chats, 'send').mockImplementation(async (_id, _body, _signal, event) => {
      await finish.promise
      event({ type: 'meta', conversation: row, user, assistant })
      event({ type: 'delta', content: 'late' })
      event({ type: 'done', assistant: completed, conversation: row })
    })
    vi.spyOn(chats, 'delete').mockResolvedValue(undefined)
    await chat.open('c')
    chat.draft('c', 'conversation draft')
    chat.draft('', 'new draft')
    const pending = chat.send('c', input)
    await chat.remove([], true)
    finish.resolve(undefined)
    await pending
    expect(chat.snapshot('c')).toBeUndefined()
    expect(chat.store.getState()).toMatchObject({
      active: '',
      lastOpened: '',
      drafts: { new: 'new draft' },
      pending: {},
      running: {},
      errors: {},
    })
    expect(chats.get).toHaveBeenCalledTimes(1)
  })

  it('discards stale history failures and private drafts after identity changes', async () => {
    const result = deferred<Conversation>()
    vi.mocked(chats.get).mockReturnValueOnce(result.promise)
    chat.draft('', 'private')
    const opening = chat.open('c')
    session.clear()
    chat.draft('', 'next account')
    result.reject(new Error('late failure'))
    await opening
    expect(chat.snapshot('c')).toBeUndefined()
    expect(chat.store.getState().errors).toEqual({})
    expect(chat.store.getState().drafts).toEqual({ new: 'next account' })
  })

  it('keeps a new reader frame when an obsolete reader finally completes', async () => {
    const old = deferred<undefined>(),
      current = deferred<undefined>()
    const emitters: ((event: ChatEvent) => void)[] = []
    vi.spyOn(chats, 'send').mockImplementation(async (_id, _body, _signal, event) => {
      emitters.push(event)
      event({ type: 'meta', conversation: row, assistant })
      await (emitters.length === 1 ? old.promise : current.promise)
    })
    await chat.open('c')
    const obsolete = chat.send('c', input)
    chat.reset()
    await chat.open('c')
    const active = chat.send('c', { ...input, request_id: 'new-request' })
    emitters[1]?.({ type: 'delta', content: 'new content' })
    expect(frames.size).toBe(1)
    old.resolve(undefined)
    await obsolete
    expect(frames.size).toBe(1)
    for (const callback of frames.values()) callback(0)
    expect(chat.snapshot('c')?.messages.at(-1)?.content).toBe('new content')
    current.resolve(undefined)
    await active
  })

  it('loads older messages without duplicates and preserves ascending chronology', async () => {
    vi.mocked(chats.messages)
      .mockResolvedValueOnce({ items: [completed, user], next_cursor: 'older' })
      .mockResolvedValueOnce({ items: [user, { ...user, id: 'old' }], next_cursor: '' })
    await chat.open('c')
    await chat.loadOlder('c')
    expect(chat.snapshot('c')?.messages.map((message) => message.id)).toEqual(['old', 'u', 'a'])
    expect(chat.snapshot('c')?.nextCursor).toBe('')
  })
})
