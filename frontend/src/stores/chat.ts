import { computed, reactive, ref, shallowRef, shallowReactive, watch } from 'vue'
import { defineStore } from 'pinia'
import { chats, type Conversation, type Message, type SendInput } from '../api/chat'
import { ApiError } from '../api/transport'
import { useAuthStore } from './auth'

export const useChatStore = defineStore('chat', () => {
  const auth = useAuthStore()
  const active = ref(''),
    lastOpened = ref(''),
    query = ref(''),
    cursor = ref('')
  const conversations = shallowRef<Conversation[]>([])
  const cache = shallowRef<Record<string, Message[]>>({})
  const drafts = reactive<Record<string, string>>({})
  const running = reactive<Record<string, boolean>>({})
  const errors = shallowRef<Record<string, unknown>>({})
  const pending = shallowReactive(new Map<string, SendInput>())
  let createID = ''
  const controllers = new Map<string, AbortController>()
  const loading = ref(false),
    listError = shallowRef<unknown>(null),
    messageLoading = ref(false)
  const older = reactive<Record<string, string>>({})
  const messages = computed(() => cache.value[active.value] ?? [])
  const current = computed(() => conversations.value.find((c) => c.id === active.value))
  const busy = computed(() => !!running[active.value] || !!current.value?.busy)
  const hasPending = computed(() => pending.has(active.value) && !!errors.value[active.value])
  let epoch = 0,
    listGeneration = 0,
    messageGeneration = 0
  let listController: AbortController | undefined, historyController: AbortController | undefined
  function reset() {
    epoch++
    listGeneration++
    messageGeneration++
    for (const c of controllers.values()) c.abort()
    controllers.clear()
    pending.clear()
    createID = ''
    listController?.abort()
    historyController?.abort()
    conversations.value = []
    cache.value = {}
    errors.value = {}
    active.value = ''
    lastOpened.value = ''
    cursor.value = ''
    query.value = ''
    listError.value = null
    loading.value = false
    messageLoading.value = false
    for (const data of [drafts, running, older])
      for (const key of Object.keys(data)) Reflect.deleteProperty(data, key)
  }
  watch(() => auth.user?.id, reset, { flush: 'sync' })
  function put(id: string, items: Message[]) {
    const copy = { ...cache.value, [id]: items }
    const keys = Object.keys(copy)
    if (keys.length > 12) {
      const old = keys.find((k) => k !== active.value && k !== id && !running[k])
      if (old) Reflect.deleteProperty(copy, old)
    }
    cache.value = copy
  }
  function upsert(row: Conversation) {
    const rows = conversations.value.filter((c) => c.id !== row.id)
    conversations.value = [row, ...rows].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.last_message_at.localeCompare(a.last_message_at) ||
        b.id.localeCompare(a.id),
    )
  }
  function message(id: string, row: Message) {
    const rows = cache.value[id] ?? []
    const index = rows.findIndex((r) => r.id === row.id)
    put(id, index < 0 ? [...rows, row] : rows.map((r, i) => (i === index ? row : r)))
  }
  function failure(id: string, error: unknown) {
    errors.value = { ...errors.value, [id]: error }
  }
  async function list(more = false) {
    if (more && (!cursor.value || loading.value)) return
    const generation = ++listGeneration,
      owner = epoch
    listController?.abort()
    listController = new AbortController()
    loading.value = true
    listError.value = null
    try {
      const result = await chats.list(
        new URLSearchParams({
          search: query.value.trim(),
          limit: '50',
          cursor: more ? cursor.value : '',
        }),
        listController.signal,
      )
      if (owner !== epoch || generation !== listGeneration) return
      conversations.value = more
        ? [
            ...conversations.value,
            ...result.items.filter((r) => !conversations.value.some((c) => c.id === r.id)),
          ]
        : result.items
      cursor.value = result.next_cursor
    } catch (error) {
      if (
        owner === epoch &&
        generation === listGeneration &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        listError.value = error
    } finally {
      if (generation === listGeneration) loading.value = false
    }
  }
  async function open(id: string) {
    active.value = id
    if (!id) {
      messageGeneration++
      historyController?.abort()
      messageLoading.value = false
      return
    }
    lastOpened.value = id
    const generation = ++messageGeneration,
      owner = epoch
    historyController?.abort()
    historyController = new AbortController()
    messageLoading.value = true
    try {
      const [row, page] = await Promise.all([
        chats.get(id, historyController.signal),
        chats.messages(id, '', historyController.signal),
      ])
      if (owner !== epoch || generation !== messageGeneration) return
      upsert(row)
      if (!running[id]) put(id, [...page.items].reverse())
      older[id] = page.next_cursor
    } catch (error) {
      if (
        owner === epoch &&
        generation === messageGeneration &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        failure(id, error)
    } finally {
      if (generation === messageGeneration) messageLoading.value = false
    }
  }
  async function loadOlder() {
    const id = active.value,
      next = older[id],
      owner = epoch
    if (!id || !next || messageLoading.value) return
    messageLoading.value = true
    try {
      const page = await chats.messages(id, next)
      if (owner !== epoch) return
      const existing = cache.value[id] ?? []
      put(
        id,
        [...page.items]
          .reverse()
          .filter((m) => !existing.some((r) => r.id === m.id))
          .concat(existing),
      )
      older[id] = page.next_cursor
    } catch (error) {
      if (owner === epoch) failure(id, error)
    } finally {
      if (owner === epoch) messageLoading.value = false
    }
  }
  async function create(model: string) {
    const id = createID || (createID = crypto.randomUUID()),
      owner = epoch
    const row = await chats.create(id, model)
    if (owner !== epoch) throw new ApiError('AUTH_REQUIRED')
    upsert(row)
    put(id, [])
    active.value = id
    lastOpened.value = id
    createID = ''
    return id
  }
  async function send(id: string, input: SendInput) {
    if (running[id]) return
    const owner = epoch,
      controller = new AbortController()
    controllers.set(id, controller)
    running[id] = true
    failure(id, null)
    pending.set(id, input)
    let delta = '',
      frame: number | undefined,
      assistant: Message | undefined
    const flush = () => {
      if (owner !== epoch || !assistant || !delta) return
      assistant = { ...assistant, content: assistant.content + delta }
      delta = ''
      message(id, assistant)
    }
    const schedule = () => {
      if (frame === undefined)
        frame = requestAnimationFrame(() => {
          frame = undefined
          flush()
        })
    }
    try {
      await chats.send(id, input, controller.signal, (e) => {
        if (owner !== epoch) return
        if (e.type === 'meta') {
          if (e.conversation) upsert(e.conversation)
          if (input.action === 'edit') {
            const rows = cache.value[id] ?? []
            const index = rows.findIndex((r) => r.id === input.last_message_id)
            if (index >= 0) put(id, rows.slice(0, index))
          }
          if (input.action === 'regenerate') {
            const rows = cache.value[id] ?? []
            const index = rows.findIndex((r) => r.id === input.last_message_id)
            if (index >= 0) put(id, rows.slice(0, index + 1))
          }
          if (e.user) message(id, e.user)
          if (e.assistant) {
            assistant = e.assistant
            message(id, e.assistant)
          }
        }
        if (e.type === 'delta') {
          delta += e.content
          schedule()
        }
        if (e.type === 'error') {
          flush()
          failure(id, new ApiError(e.code))
          if (e.assistant) {
            assistant = e.assistant
            message(id, e.assistant)
          }
        }
        if (e.type === 'done') {
          flush()
          if (e.assistant) {
            assistant = e.assistant
            message(id, e.assistant)
          }
          if (e.conversation) upsert(e.conversation)
          pending.delete(id)
        }
      })
    } catch (error) {
      if (owner === epoch)
        failure(
          id,
          error instanceof DOMException && error.name === 'AbortError'
            ? new ApiError('CHAT_INTERRUPTED')
            : error,
        )
    } finally {
      if (frame !== undefined) cancelAnimationFrame(frame)
      flush()
      if (owner === epoch) {
        running[id] = false
        controllers.delete(id)
        // Reconcile saved status after disconnect, stop or a response lost after commit.
        try {
          const [row, page] = await Promise.all([chats.get(id), chats.messages(id)])
          if (owner === epoch) {
            upsert(row)
            put(id, [...page.items].reverse())
            older[id] = page.next_cursor
          }
        } catch {
          /* Deleted conversations need no local reconciliation. */
        }
      }
    }
  }
  async function retryPending() {
    const input = pending.get(active.value)
    if (input) await send(active.value, input)
  }
  async function stop() {
    const id = active.value
    if (!id) return
    try {
      await chats.stop(id)
      if (!running[id]) {
        // A generation opened in another tab has no local reader; refresh its durable checkpoint.
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 600))
          await open(id)
          if (!current.value?.busy) break
        }
      }
    } catch (error) {
      failure(id, error)
    }
  }
  async function update(row: Conversation, title: string, pinned = row.pinned) {
    const result = await chats.update(row, title, pinned)
    upsert(result)
  }
  async function remove(ids: string[], all = false) {
    await chats.delete(ids, all)
    const removed = all ? conversations.value.map((c) => c.id) : ids
    for (const id of removed) {
      controllers.get(id)?.abort()
      Reflect.deleteProperty(drafts, id)
      Reflect.deleteProperty(older, id)
      pending.delete(id)
    }
    conversations.value = conversations.value.filter((c) => !removed.includes(c.id))
    const copy = { ...cache.value }
    for (const id of removed) Reflect.deleteProperty(copy, id)
    cache.value = copy
    if (removed.includes(lastOpened.value)) lastOpened.value = ''
    if (removed.includes(active.value)) active.value = ''
    await list()
  }
  return {
    active,
    lastOpened,
    query,
    cursor,
    conversations,
    messages,
    current,
    busy,
    drafts,
    running,
    errors,
    pending,
    loading,
    listError,
    messageLoading,
    older,
    hasPending,
    list,
    open,
    loadOlder,
    create,
    send,
    retryPending,
    stop,
    update,
    remove,
    reset,
  }
})
