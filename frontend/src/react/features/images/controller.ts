import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { createStore } from 'zustand/vanilla'
import {
  images,
  terminal,
  type ImageConversation,
  type ImageInput,
  type ImageTask,
} from '../../../api/images'
import type { SessionService } from '../../../api/auth-session'
import { ApiError } from '../../../api/transport'

export interface ImageDraft {
  prompt: string
  quality: ImageInput['quality'] | ''
  size: string
  ratio: string
  n: number
  references: string[]
  outputFormat?: ImageInput['output_format']
}
export const emptyImageDraft: ImageDraft = {
  prompt: '',
  quality: '',
  size: '',
  ratio: '',
  n: 0,
  references: [],
}
export interface ImageSnapshot {
  conversation: ImageConversation
  tasks: ImageTask[]
  nextCursor: string
}
interface PendingSubmission {
  input: ImageInput
  key: string
  create: boolean
  source: 'draft' | 'task' | 'editor'
}
interface ImageState {
  active: string
  lastOpened: string
  restoredModel: { conversationId: string; modelId: string } | null
  drafts: Record<string, ImageDraft>
  pending: Record<string, PendingSubmission>
  sending: Record<string, boolean>
  errors: Record<string, unknown>
}
const emptyState = (): ImageState => ({
  active: '',
  lastOpened: '',
  restoredModel: null,
  drafts: {},
  pending: {},
  sending: {},
  errors: {},
})
export function imageSubmissionScope(state: Pick<ImageState, 'pending'>, id: string) {
  // Opening history must retain the original new-draft submission and its key.
  if (!id) return 'new'
  return (
    Object.keys(state.pending).find(
      (scope) => state.pending[scope]?.input.conversation_id === id,
    ) ?? id
  )
}
const sorted = (rows: ImageTask[]) =>
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
function mergeTasks(old: ImageTask[], incoming: ImageTask[]) {
  const rows = new Map(old.map((row) => [row.id, row]))
  for (const row of incoming)
    if ((rows.get(row.id)?.version ?? -1) <= row.version) rows.set(row.id, row)
  return sorted([...rows.values()])
}

export function createImageController(session: SessionService, client: QueryClient) {
  const store = createStore<ImageState>()(emptyState)
  const followers = new Map<string, AbortController>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const deleted = new Set<string>(),
    olderLoads = new Set<string>()
  let generation = 0,
    view = 0
  let identity = session.getSnapshot().user?.id ?? '',
    epoch = session.snapshot().epoch
  const key = (id: string) => ['user', identity, 'image-conversation', id] as const
  const filteredKey = (id: string) => [...key(id), 'filtered-tasks'] as const
  const historyKey = () => ['user', identity, 'sidebar-history', 'image'] as const
  const valid = (owner: number, id: string) => owner === generation && !deleted.has(id)
  const snapshot = (id: string) => client.getQueryData<ImageSnapshot>(key(id))
  function stopFollowing() {
    view++
    for (const controller of followers.values()) controller.abort()
    for (const timer of timers.values()) clearTimeout(timer)
    followers.clear()
    timers.clear()
  }
  function reset() {
    generation++
    stopFollowing()
    deleted.clear()
    olderLoads.clear()
    client.removeQueries({ queryKey: ['user', identity, 'image-conversation'] })
    store.setState(emptyState(), true)
  }
  const unsubscribe = session.subscribe(() => {
    const next = session.getSnapshot()
    if (next.epoch === epoch && (next.user?.id ?? '') === identity) return
    reset()
    epoch = next.epoch
    identity = next.user?.id ?? ''
  })
  function refreshFinancials() {
    void client.invalidateQueries({ queryKey: ['user', identity, 'credits'] })
    void client.invalidateQueries({ queryKey: ['user', identity, 'credit-ledger'] })
    void client.invalidateQueries({ queryKey: ['user', identity, 'credit-usage'] })
  }
  function refreshFiles() {
    void client.invalidateQueries({ queryKey: ['user', identity, 'image-gallery'] })
    void client.invalidateQueries({ queryKey: ['user', identity, 'image-library'] })
  }
  function refreshHistory(id: string) {
    void client.invalidateQueries({ queryKey: key(id) })
    refreshFiles()
  }
  function failure(id: string, error: unknown) {
    if (!deleted.has(id))
      store.setState((state) => ({ errors: { ...state.errors, [id || 'new']: error } }))
  }
  function put(id: string, value: ImageSnapshot) {
    if (deleted.has(id)) return
    client.setQueryData(key(id), value)
    const entries = client
      .getQueryCache()
      .findAll({ queryKey: ['user', identity, 'image-conversation'] })
      .filter((entry) => entry.queryKey.length === 4)
    if (entries.length > 12) {
      const old = entries.find(
        (entry) =>
          entry.queryKey[3] !== id &&
          entry.queryKey[3] !== store.getState().active &&
          !entry.getObserversCount(),
      )
      if (old) client.removeQueries({ queryKey: old.queryKey })
    }
  }
  function accept(row: ImageTask, submitted = false) {
    if (deleted.has(row.conversation_id)) return
    const data = snapshot(row.conversation_id)
    if (!data) return
    const old = data.tasks.find((item) => item.id === row.id)
    if (old && old.version > row.version) return
    if (old || submitted) {
      put(row.conversation_id, { ...data, tasks: mergeTasks(data.tasks, [row]) })
    }
    if (old?.version !== row.version || old.queue_position !== row.queue_position) {
      void client.invalidateQueries({ queryKey: filteredKey(row.conversation_id) })
    }
    if (terminal(row.status) && (!old || !terminal(old.status))) {
      refreshFinancials()
      refreshFiles()
      void client.invalidateQueries({ queryKey: historyKey() })
    }
  }
  function follow(task: ImageTask) {
    if (terminal(task.status) || followers.has(task.id)) return
    const controller = new AbortController(),
      owner = generation,
      currentView = view
    followers.set(task.id, controller)
    const live = () =>
      valid(owner, task.conversation_id) && currentView === view && !controller.signal.aborted
    const cleanup = () => {
      if (followers.get(task.id) === controller) {
        followers.delete(task.id)
        const timer = timers.get(task.id)
        if (timer) clearTimeout(timer)
        timers.delete(task.id)
      }
    }
    const poll = async () => {
      if (!live()) return
      try {
        const row = await images.task(task.id, false, controller.signal)
        if (!live()) return
        accept(row)
        if (terminal(row.status)) {
          cleanup()
          return
        }
      } catch (error) {
        if (!live()) return
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          failure(task.conversation_id, error)
          cleanup()
          return
        }
      }
      if (live())
        timers.set(
          task.id,
          setTimeout(() => {
            void poll()
          }, 3000),
        )
    }
    const fallback = () => {
      if (!live()) return
      const saved = snapshot(task.conversation_id)?.tasks.find((row) => row.id === task.id)
      if (saved && terminal(saved.status)) cleanup()
      else
        timers.set(
          task.id,
          setTimeout(() => {
            void poll()
          }, 3000),
        )
    }
    void images
      .events(task.id, controller.signal, (row) => {
        if (live()) accept(row)
      })
      .then(fallback, fallback)
  }
  function options(id: string) {
    const owner = generation
    return queryOptions({
      queryKey: key(id),
      enabled: !!id,
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      queryFn: async ({ signal }): Promise<ImageSnapshot> => {
        if (!valid(owner, id)) throw new ApiError('AUTH_REQUIRED', 401)
        const [conversation, page] = await Promise.all([
          images.conversation(id, signal),
          images.tasks(new URLSearchParams({ conversation_id: id, limit: '50' }), signal),
        ])
        if (!valid(owner, id)) throw new ApiError('AUTH_REQUIRED', 401)
        const cached = snapshot(id)
        return {
          conversation:
            cached && cached.conversation.version > conversation.version
              ? cached.conversation
              : conversation,
          tasks: mergeTasks(cached?.tasks ?? [], page.items),
          nextCursor:
            cached?.tasks.length && cached.tasks.length > 50 ? cached.nextCursor : page.next_cursor,
        }
      },
    })
  }
  function activate(id: string) {
    stopFollowing()
    store.setState((state) => ({ active: id, lastOpened: id || state.lastOpened }))
  }
  async function open(id: string) {
    activate(id)
    const owner = generation,
      currentView = view
    if (!id) return
    try {
      const data = await client.fetchQuery(options(id))
      if (valid(owner, id) && currentView === view) for (const task of data.tasks) follow(task)
    } catch (error) {
      if (valid(owner, id) && currentView === view) failure(id, error)
    }
  }
  function draft(id: string, patch: Partial<ImageDraft>) {
    const scope = id || 'new'
    store.setState((state) => ({
      drafts: {
        ...state.drafts,
        [scope]: { ...(state.drafts[scope] ?? emptyImageDraft), ...patch },
      },
    }))
  }
  function restoreDraft(id: string, value: ImageDraft, modelId: string) {
    store.setState((state) => ({
      drafts: { ...state.drafts, [id || 'new']: value },
      restoredModel: { conversationId: id, modelId },
    }))
  }
  function clearRestoredModel() {
    store.setState({ restoredModel: null })
  }
  function preferRestoredModel(conversationId: string, modelId: string) {
    store.setState({ restoredModel: { conversationId, modelId } })
  }
  async function loadOlder(id: string) {
    const data = snapshot(id)
    if (!data?.nextCursor || olderLoads.has(id)) return
    const owner = generation
    olderLoads.add(id)
    try {
      const page = await images.tasks(
        new URLSearchParams({ conversation_id: id, cursor: data.nextCursor, limit: '50' }),
      )
      const current = snapshot(id)
      if (!valid(owner, id) || !current) return
      put(id, {
        ...current,
        tasks: mergeTasks(current.tasks, page.items),
        nextCursor: page.next_cursor,
      })
      if (store.getState().active === id) for (const task of page.items) follow(task)
    } finally {
      if (valid(owner, id)) olderLoads.delete(id)
    }
  }
  async function submit(
    id: string,
    input?: Omit<ImageInput, 'conversation_id'>,
    source: PendingSubmission['source'] = 'draft',
  ): Promise<string | undefined> {
    const state = store.getState(),
      scope = imageSubmissionScope(state, id)
    const pending = state.pending[scope]
    if (
      state.sending[scope] ||
      (pending &&
        (source === 'task' || (source === 'editor' && (input || pending.source !== 'editor'))))
    )
      return
    const replay = !!state.pending[scope]
    let submission = state.pending[scope]
    if (!submission) {
      if (!input?.prompt.trim() || !input.model_id) throw new ApiError('INVALID_INPUT')
      submission = {
        input: {
          ...input,
          prompt: input.prompt.trim(),
          reference_file_ids: [...input.reference_file_ids],
          conversation_id: id || crypto.randomUUID(),
        },
        key: crypto.randomUUID(),
        create: !id,
        source,
      }
    }
    const request = submission,
      owner = generation,
      currentView = view
    store.setState((current) => ({
      pending: { ...current.pending, [scope]: request },
      sending: { ...current.sending, [scope]: true },
      errors: { ...current.errors, [scope]: null },
    }))
    try {
      if (request.create) {
        const conversation = await images.create(
          request.input.conversation_id,
          request.input.model_id,
        )
        if (!valid(owner, request.input.conversation_id)) return
        put(conversation.id, { conversation, tasks: [], nextCursor: '' })
        void client.invalidateQueries({ queryKey: historyKey() })
        request.create = false
      }
      const row = await images.submit(request.input, request.key)
      if (!valid(owner, row.conversation_id)) return
      accept(row, true)
      store.setState((current) => {
        const pending = { ...current.pending }
        Reflect.deleteProperty(pending, scope)
        if (request.source !== 'draft') return { pending, lastOpened: row.conversation_id }
        const drafts = { ...current.drafts }
        const source = drafts[scope] ?? emptyImageDraft
        // Do not clear text or references replaced by another view during submission.
        if (
          source.prompt.trim() === request.input.prompt &&
          source.references.join(',') === request.input.reference_file_ids.join(',')
        )
          drafts[scope] = { ...source, prompt: '', references: [] }
        if (scope === 'new') {
          drafts[row.conversation_id] = { ...source, prompt: '', references: [] }
        }
        return { pending, drafts, lastOpened: row.conversation_id }
      })
      refreshFinancials()
      void client.invalidateQueries({ queryKey: historyKey() })
      void client.invalidateQueries({ queryKey: key(row.conversation_id), exact: true })
      if (currentView !== view) return
      store.setState({ active: row.conversation_id })
      follow(row)
      return row.conversation_id
    } catch (error) {
      if (valid(owner, request.input.conversation_id)) {
        failure(scope === 'new' ? '' : scope, error)
        void client.invalidateQueries({ queryKey: historyKey() })
        // A later rejection cannot disprove an earlier unknown transaction outcome.
        if (!replay && error instanceof ApiError && error.status > 0 && error.status < 500)
          store.setState((current) => {
            const pending = { ...current.pending }
            Reflect.deleteProperty(pending, scope)
            return { pending }
          })
      }
    } finally {
      if (valid(owner, request.input.conversation_id))
        store.setState((current) => ({ sending: { ...current.sending, [scope]: false } }))
    }
  }
  async function regenerate(task: ImageTask) {
    if (task.conversation_id !== store.getState().active) return
    return regenerateInto(task, task.conversation_id)
  }
  async function regenerateInto(task: ImageTask, conversationId: string) {
    if (!task.content_visible || !task.prompt.trim() || !task.model_id) return
    return submit(
      conversationId,
      {
        model_id: task.model_id,
        prompt: task.prompt,
        quality: task.quality,
        size: task.size,
        ratio: task.ratio,
        n: task.n,
        reference_file_ids: task.reference_file_ids,
        ...(task.output_format ? { output_format: task.output_format } : {}),
        ...(task.edit_options ? { edit_options: task.edit_options } : {}),
      },
      'task',
    )
  }
  async function cancel(task: ImageTask) {
    const owner = generation
    const result = await images.cancel(task.id)
    if (valid(owner, task.conversation_id)) accept(result)
  }
  async function update(row: ImageConversation, title: string, pinned = row.pinned) {
    const owner = generation
    const result = await images.update(row, title, pinned)
    if (!valid(owner, row.id)) return
    const data = snapshot(row.id)
    if (data) put(row.id, { ...data, conversation: result })
    void client.invalidateQueries({ queryKey: historyKey() })
  }
  async function remove(id: string) {
    const owner = generation
    await images.removeConversation(id)
    if (!valid(owner, id)) return
    deleted.add(id)
    client.removeQueries({ queryKey: key(id) })
    store.setState((current) => {
      const drafts = { ...current.drafts },
        pending = { ...current.pending },
        errors = { ...current.errors },
        sending = { ...current.sending }
      for (const scope of new Set([
        id,
        ...Object.keys(pending).filter((key) => pending[key]?.input.conversation_id === id),
      ])) {
        Reflect.deleteProperty(drafts, scope)
        Reflect.deleteProperty(pending, scope)
        Reflect.deleteProperty(errors, scope)
        Reflect.deleteProperty(sending, scope)
      }
      return {
        drafts,
        pending,
        errors,
        sending,
        lastOpened: current.lastOpened === id ? '' : current.lastOpened,
      }
    })
    if (store.getState().active === id) {
      activate('')
    }
    refreshFinancials()
    void client.invalidateQueries({ queryKey: historyKey() })
  }
  return {
    store,
    options,
    filteredKey,
    refreshHistory,
    snapshot,
    open,
    activate,
    draft,
    restoreDraft,
    clearRestoredModel,
    preferRestoredModel,
    submit,
    regenerate,
    regenerateInto,
    cancel,
    update,
    remove,
    loadOlder,
    stopFollowing,
    reset,
    dispose() {
      unsubscribe()
      reset()
    },
  }
}
export type ImageController = ReturnType<typeof createImageController>
