import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { createStore } from 'zustand/vanilla'
import { chats, type Conversation, type Message, type SendInput } from '../../../api/chat'
import type { SessionService } from '../../../api/auth-session'
import { ApiError } from '../../../api/transport'

export interface ChatSnapshot {
  conversation: Conversation
  messages: Message[]
  nextCursor: string
}
export interface ChatState {
  active: string
  lastOpened: string
  drafts: Record<string, string>
  references: Record<string, string[]>
  running: Record<string, boolean>
  errors: Record<string, unknown>
  pending: Record<string, SendInput>
}
const emptyState = (): ChatState => ({
  active: '',
  lastOpened: '',
  drafts: {},
  references: {},
  running: {},
  errors: {},
  pending: {},
})

export function createChatController(session: SessionService, client: QueryClient) {
  const store = createStore<ChatState>()(emptyState)
  const controllers = new Map<string, AbortController>()
  const frames = new Map<string, number>()
  const deleted = new Set<string>()
  const olderLoads = new Set<string>()
  let generation = 0
  let identity = session.getSnapshot().user?.id ?? ''
  let epoch = session.snapshot().epoch
  let creation: { id: string; model: string } | undefined
  let creating: Promise<string> | undefined
  const key = (id: string) => ['user', identity, 'chat', id] as const
  const historyKey = () => ['user', identity, 'sidebar-history', 'chat'] as const
  const valid = (owner: number, id: string) => owner === generation && !deleted.has(id)
  const snapshot = (id: string) => client.getQueryData<ChatSnapshot>(key(id))
  function reset() {
    generation++
    for (const controller of controllers.values()) controller.abort()
    for (const frame of frames.values()) cancelAnimationFrame(frame)
    controllers.clear()
    frames.clear()
    olderLoads.clear()
    deleted.clear()
    client.removeQueries({ queryKey: ['user', identity, 'chat'] })
    store.setState(emptyState(), true)
    creation = undefined
    creating = undefined
  }
  const unsubscribe = session.subscribe(() => {
    const next = session.getSnapshot()
    if (next.epoch === epoch && (next.user?.id ?? '') === identity) return
    reset()
    epoch = next.epoch
    identity = next.user?.id ?? ''
  })
  function put(id: string, value: ChatSnapshot) {
    if (deleted.has(id)) return
    client.setQueryData(key(id), value)
    const entries = client.getQueryCache().findAll({ queryKey: ['user', identity, 'chat'] })
    if (entries.length > 12) {
      const old = entries.find((entry) => {
        const candidate = entry.queryKey[3]
        return (
          typeof candidate === 'string' &&
          candidate !== id &&
          candidate !== store.getState().active &&
          !store.getState().running[candidate] &&
          !entry.getObserversCount()
        )
      })
      if (old) client.removeQueries({ queryKey: old.queryKey, exact: true })
    }
  }
  function failure(id: string, error: unknown) {
    if (!deleted.has(id)) store.setState((state) => ({ errors: { ...state.errors, [id]: error } }))
  }
  function message(id: string, row: Message) {
    const data = snapshot(id)
    if (!data) return
    const exists = data.messages.some((item) => item.id === row.id)
    put(id, {
      ...data,
      messages: exists
        ? data.messages.map((item) => (item.id === row.id ? row : item))
        : [...data.messages, row],
    })
  }
  function options(id: string) {
    const owner = generation
    return queryOptions({
      queryKey: key(id),
      queryFn: async ({ signal }): Promise<ChatSnapshot> => {
        if (!valid(owner, id)) throw new ApiError('AUTH_REQUIRED', 401)
        const cached = snapshot(id)
        if (store.getState().running[id] && cached) return cached
        const [conversation, page] = await Promise.all([
          chats.get(id, signal),
          chats.messages(id, '', signal),
        ])
        if (!valid(owner, id)) throw new ApiError('AUTH_REQUIRED', 401)
        // A focus/history request started before a send must not overwrite live deltas.
        const live = snapshot(id)
        return store.getState().running[id] && live
          ? live
          : { conversation, messages: [...page.items].reverse(), nextCursor: page.next_cursor }
      },
      enabled: !!id,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    })
  }
  function activate(id: string) {
    store.setState((state) => ({ active: id, lastOpened: id || state.lastOpened }))
  }
  async function open(id: string) {
    const owner = generation
    activate(id)
    if (!id) return
    try {
      const data = await client.fetchQuery(options(id))
      resume(id, data)
    } catch (error) {
      if (valid(owner, id)) failure(id, error)
    }
  }
  function draft(id: string, text: string) {
    store.setState((state) => ({ drafts: { ...state.drafts, [id || 'new']: text } }))
  }
  function references(id: string, ids: string[]) {
    store.setState((state) => ({ references: { ...state.references, [id || 'new']: [...ids] } }))
  }
  async function create(model: string): Promise<string> {
    if (creating) return creating
    const request = creation ?? (creation = { id: crypto.randomUUID(), model })
    const owner = generation
    const operation = (async () => {
      const row = await chats.create(request.id, request.model)
      if (!valid(owner, row.id)) throw new ApiError('AUTH_REQUIRED', 401)
      put(row.id, { conversation: row, messages: [], nextCursor: '' })
      activate(row.id)
      creation = undefined
      void client.invalidateQueries({ queryKey: historyKey() })
      return row.id
    })()
    creating = operation
    try {
      return await operation
    } finally {
      if (creating === operation) creating = undefined
    }
  }
  async function loadOlder(id: string) {
    const data = snapshot(id),
      owner = generation
    if (!data?.nextCursor || olderLoads.has(id)) return
    olderLoads.add(id)
    try {
      const page = await chats.messages(id, data.nextCursor)
      const current = snapshot(id)
      if (!valid(owner, id) || !current || current.nextCursor !== data.nextCursor) return
      const existing = new Set(current.messages.map((item) => item.id))
      put(id, {
        ...current,
        messages: [...page.items]
          .reverse()
          .filter((item) => !existing.has(item.id))
          .concat(current.messages),
        nextCursor: page.next_cursor,
      })
    } finally {
      if (owner === generation) olderLoads.delete(id)
    }
  }
  async function send(id: string, input: SendInput, resumeOnly = false) {
    if (store.getState().running[id] || deleted.has(id)) return
    input = {
      ...input,
      ...(input.reference_file_ids ? { reference_file_ids: [...input.reference_file_ids] } : {}),
    }
    const owner = generation,
      controller = new AbortController()
    controllers.set(id, controller)
    store.setState((state) => ({
      running: { ...state.running, [id]: true },
      ...(!resumeOnly
        ? {
            pending: {
              ...state.pending,
              [id]: {
                ...input,
                ...(input.reference_file_ids
                  ? { reference_file_ids: [...input.reference_file_ids] }
                  : {}),
              },
            },
          }
        : {}),
    }))
    failure(id, null)
    let delta = '',
      assistant: Message | undefined
    const flush = () => {
      if (!valid(owner, id) || !assistant || !delta) return
      assistant = { ...assistant, content: assistant.content + delta }
      delta = ''
      message(id, assistant)
    }
    const schedule = () => {
      if (frames.has(id)) return
      frames.set(
        id,
        requestAnimationFrame(() => {
          frames.delete(id)
          flush()
        }),
      )
    }
    try {
      await chats.send(
        id,
        input,
        controller.signal,
        (event) => {
          if (!valid(owner, id)) return
          if (event.type === 'meta') {
            const previous = snapshot(id)
            if (event.conversation)
              put(id, {
                conversation: event.conversation,
                messages: previous?.messages ?? [],
                nextCursor: previous?.nextCursor ?? '',
              })
            const current = snapshot(id)
            if (current && (input.action === 'edit' || input.action === 'regenerate')) {
              const index = current.messages.findIndex((item) => item.id === input.last_message_id)
              if (index >= 0)
                put(id, {
                  ...current,
                  messages: current.messages.slice(
                    0,
                    index + (input.action === 'regenerate' ? 1 : 0),
                  ),
                })
            }
            if (event.user) message(id, event.user)
            if (event.assistant) {
              assistant = event.assistant
              message(id, assistant)
            }
          } else if (event.type === 'delta') {
            delta += event.content
            schedule()
          } else if (event.type === 'error' || event.type === 'done') {
            flush()
            if (event.assistant) {
              assistant = event.assistant
              message(id, assistant)
            }
            if (event.type === 'error') failure(id, new ApiError(event.code))
            else {
              const data = snapshot(id)
              if (event.conversation && data) put(id, { ...data, conversation: event.conversation })
              store.setState((state) => ({
                pending: Object.fromEntries(
                  Object.entries(state.pending).filter(([value]) => value !== id),
                ),
              }))
            }
          }
        },
        resumeOnly,
      )
    } catch (error) {
      if (valid(owner, id))
        failure(
          id,
          error instanceof DOMException && error.name === 'AbortError'
            ? new ApiError('CHAT_INTERRUPTED')
            : error,
        )
    } finally {
      if (owner === generation) {
        const frame = frames.get(id)
        if (frame !== undefined) cancelAnimationFrame(frame)
        frames.delete(id)
        flush()
      }
      if (valid(owner, id)) {
        try {
          const [conversation, page] = await Promise.all([
            chats.get(id, controller.signal),
            chats.messages(id, '', controller.signal),
          ])
          if (valid(owner, id))
            put(id, {
              conversation,
              messages: [...page.items].reverse(),
              nextCursor: page.next_cursor,
            })
        } catch {
          /* Preserve the last confirmed stream checkpoint when reconciliation is offline. */
        }
        if (valid(owner, id)) {
          controllers.delete(id)
          store.setState((state) => ({ running: { ...state.running, [id]: false } }))
          void client.invalidateQueries({ queryKey: historyKey() })
        }
      }
    }
  }
  function resume(id: string, data: ChatSnapshot) {
    const streaming = data.messages.find(
      (item) => item.role === 'assistant' && item.status === 'streaming',
    )
    if (
      data.conversation.busy &&
      streaming &&
      data.conversation.model_id &&
      !store.getState().running[id] &&
      !store.getState().errors[id]
    )
      void send(
        id,
        {
          request_id: streaming.request_id,
          model_id: data.conversation.model_id,
          action: 'send',
          content: '',
        },
        true,
      )
  }
  async function retryPending(id: string) {
    const input = store.getState().pending[id]
    if (input) await send(id, input)
  }
  async function stop(id: string) {
    const owner = generation
    try {
      await chats.stop(id)
      if (!valid(owner, id) || store.getState().running[id]) return
      // Another tab may own the reader. Stop is a server command, never a reader abort.
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 600))
        if (!valid(owner, id)) return
        await client.invalidateQueries({ queryKey: key(id), exact: true, refetchType: 'none' })
        const data = await client.fetchQuery(options(id))
        if (!data.conversation.busy) break
      }
    } catch (error) {
      if (valid(owner, id)) failure(id, error)
    }
  }
  async function update(row: Conversation, title: string, pinned = row.pinned) {
    const owner = generation
    const updated = await chats.update(row, title, pinned)
    if (!valid(owner, row.id)) return
    const data = snapshot(row.id)
    if (data) put(row.id, { ...data, conversation: updated })
    void client.invalidateQueries({ queryKey: historyKey() })
  }
  async function remove(ids: string[], all = false) {
    const owner = generation
    await chats.delete(ids, all)
    if (owner !== generation) return
    const state = store.getState()
    const removed = new Set(
      all
        ? [
            ...client
              .getQueryCache()
              .findAll({ queryKey: ['user', identity, 'chat'] })
              .flatMap((entry) =>
                typeof entry.queryKey[3] === 'string' ? [entry.queryKey[3]] : [],
              ),
            ...Object.keys(state.running),
            ...Object.keys(state.pending),
            ...Object.keys(state.drafts).filter((id) => id !== 'new'),
            ...Object.keys(state.references).filter((id) => id !== 'new'),
            state.active,
            state.lastOpened,
            creation?.id ?? '',
          ].filter(Boolean)
        : ids,
    )
    for (const id of removed) {
      deleted.add(id)
      controllers.get(id)?.abort()
      controllers.delete(id)
      const frame = frames.get(id)
      if (frame !== undefined) cancelAnimationFrame(frame)
      frames.delete(id)
      client.removeQueries({ queryKey: key(id), exact: true })
    }
    const retain = <T>(values: Record<string, T>) =>
      Object.fromEntries(Object.entries(values).filter(([id]) => !removed.has(id)))
    store.setState({
      active: removed.has(state.active) ? '' : state.active,
      lastOpened: removed.has(state.lastOpened) ? '' : state.lastOpened,
      drafts: retain(state.drafts),
      references: retain(state.references),
      running: retain(state.running),
      errors: retain(state.errors),
      pending: retain(state.pending),
    })
    if (all) creation = undefined
    await client.invalidateQueries({ queryKey: historyKey() })
  }
  return {
    store,
    options,
    snapshot,
    activate,
    open,
    draft,
    references,
    create,
    loadOlder,
    send,
    resume,
    retryPending,
    stop,
    update,
    remove,
    reset,
    dispose() {
      unsubscribe()
      reset()
    },
  }
}
export type ChatController = ReturnType<typeof createChatController>
