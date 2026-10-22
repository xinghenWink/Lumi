import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { chats, type Conversation, type Message } from '../api/chat'
import { useChatStore } from './chat'
import { useAuthStore } from './auth'
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
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())
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
    const store = useChatStore()
    store.active = 'c'
    await store.send('c', { request_id: 'r', model_id: 'm', content: 'question', action: 'send' })
    expect(store.hasPending).toBe(true)
    expect(store.messages.at(-1)?.content).toBe('saved')
    await store.retryPending()
    expect(send.mock.calls[1]?.[1].request_id).toBe('r')
    expect(store.hasPending).toBe(false)
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
    const store = useChatStore()
    await store.open('c')
    await store.send('c', {
      request_id: 'r2',
      model_id: 'm',
      action: 'regenerate',
      content: '',
      last_message_id: 'u',
    })
    expect(store.messages.map((m) => m.id)).toEqual(['u', 'a'])
    expect(store.messages.at(-1)?.status).toBe('completed')
  })
  it('discards pending loads and drafts when the signed-in account changes', async () => {
    let resolve: ((value: { items: Conversation[]; next_cursor: string }) => void) | undefined
    vi.spyOn(chats, 'list').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const store = useChatStore()
    store.drafts.new = 'private draft'
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
    resolve?.({ items: [row], next_cursor: '' })
    await pending
    expect(store.conversations).toEqual([])
    expect(store.drafts.new).toBeUndefined()
  })
})
