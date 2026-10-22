import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  images,
  terminal,
  type ImageConfiguration,
  type ImageConversation,
  type ImageTask,
  type ImageInput,
  type ImageFile,
} from '../api/images'
import { credits } from '../api/credits'
import { ApiError } from '../api/transport'
import { useAuthStore } from './auth'
import { useModelStore } from './models'
import { operations, type Preferences } from '../api/operations'
export interface ImageDraft {
  prompt: string
  quality: ImageInput['quality']
  size: string
  ratio: string
  n: number
  references: ImageFile[]
}
export const useImageStore = defineStore('images', () => {
  const auth = useAuthStore(),
    models = useModelStore()
  const configuration = shallowRef<ImageConfiguration>(),
    conversations = shallowRef<ImageConversation[]>([])
  const tasks = shallowRef<ImageTask[]>([]),
    current = shallowRef<ImageConversation>()
  const active = ref(''),
    lastOpened = ref(''),
    balance = ref(0),
    loading = ref(false),
    sending = ref(false)
  const error = shallowRef<unknown>(),
    listError = shallowRef<unknown>(),
    query = ref(''),
    cursor = ref(''),
    older = ref('')
  const drafts = reactive<Record<string, ImageDraft>>({})
  const preferences = shallowRef<Preferences>()
  const pending = shallowRef<{ input: ImageInput; key: string; create: boolean }>()
  const draft = computed(() => {
    const id = active.value || 'new'
    return (
      drafts[id] ??
      (drafts[id] = {
        prompt: '',
        quality: preferences.value?.image_quality ?? 'medium',
        size: preferences.value
          ? (configuration.value?.ratio_sizes[preferences.value.image_ratio] ?? '1024x1024')
          : '1024x1024',
        ratio: preferences.value?.image_ratio ?? '',
        n: preferences.value?.image_count ?? 1,
        references: [],
      })
    )
  })
  let epoch = 0,
    openVersion = 0,
    listVersion = 0,
    openController: AbortController | undefined
  const followers = new Map<string, AbortController>(),
    timers = new Map<string, ReturnType<typeof setTimeout>>()
  function stopFollowing() {
    for (const c of followers.values()) c.abort()
    for (const timer of timers.values()) clearTimeout(timer)
    followers.clear()
    timers.clear()
  }
  function reset() {
    preferences.value = undefined
    epoch++
    openVersion++
    listVersion++
    openController?.abort()
    stopFollowing()
    configuration.value = undefined
    conversations.value = []
    tasks.value = []
    current.value = undefined
    active.value = ''
    lastOpened.value = ''
    balance.value = 0
    loading.value = false
    sending.value = false
    error.value = null
    listError.value = null
    pending.value = undefined
    cursor.value = ''
    older.value = ''
    query.value = ''
    for (const key of Object.keys(drafts)) Reflect.deleteProperty(drafts, key)
  }
  watch(() => auth.user?.id, reset, { flush: 'sync' })
  async function refreshBalance() {
    const generation = epoch
    try {
      const account = await credits.account()
      if (generation === epoch) balance.value = account.total
    } catch (e) {
      if (generation === epoch) error.value = e
    }
  }
  async function initialize() {
    const generation = epoch
    try {
      const [config] = await Promise.all([images.options(), refreshBalance()])
      if (generation === epoch) configuration.value = config
      try {
        const pref = await operations.preferences()
        if (generation === epoch) {
          preferences.value = pref
          const currentDraft = drafts[active.value || 'new']
          if (currentDraft && !currentDraft.prompt && !currentDraft.references.length) {
            currentDraft.quality = pref.image_quality
            currentDraft.ratio = pref.image_ratio
            currentDraft.size = config.ratio_sizes[pref.image_ratio] ?? currentDraft.size
            currentDraft.n = pref.image_count
          }
        }
      } catch {
        /* Generation remains available with local defaults. */
      }
    } catch (e) {
      if (generation === epoch) error.value = e
    }
  }
  async function list(more = false) {
    const generation = epoch,
      version = ++listVersion
    listError.value = null
    try {
      const q = new URLSearchParams({ limit: '50', search: query.value })
      if (more && cursor.value) q.set('cursor', cursor.value)
      const page = await images.conversations(q)
      if (generation !== epoch || version !== listVersion) return
      conversations.value = more ? [...conversations.value, ...page.items] : page.items
      cursor.value = page.next_cursor
    } catch (e) {
      if (generation === epoch && version === listVersion) listError.value = e
    }
  }
  function upsertConversation(row: ImageConversation) {
    const rows = [row, ...conversations.value.filter((c) => c.id !== row.id)]
    conversations.value = rows.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.last_message_at.localeCompare(a.last_message_at),
    )
    if (current.value?.id === row.id) current.value = row
  }
  function accept(row: ImageTask) {
    if (row.conversation_id !== active.value) return
    const old = tasks.value.find((t) => t.id === row.id)
    if (old && old.version > row.version) return
    tasks.value = [...tasks.value.filter((t) => t.id !== row.id), row].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    )
    if (terminal(row.status) && (!old || !terminal(old.status))) void refreshBalance()
  }
  function follow(id: string) {
    if (followers.has(id)) return
    const controller = new AbortController(),
      generation = epoch,
      view = openVersion
    followers.set(id, controller)
    const valid = () => !controller.signal.aborted && generation === epoch && view === openVersion
    const poll = async () => {
      if (!valid()) return
      try {
        const row = await images.task(id, false, controller.signal)
        if (!valid()) return
        accept(row)
        if (terminal(row.status)) {
          followers.delete(id)
          timers.delete(id)
          return
        }
      } catch (e) {
        if (!valid()) return
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          error.value = e
          followers.delete(id)
          return
        }
      }
      timers.set(
        id,
        setTimeout(() => void poll(), 3000),
      )
    }
    void images
      .events(id, controller.signal, (row) => {
        if (valid()) accept(row)
      })
      .then(() => {
        if (valid() && !terminal(tasks.value.find((t) => t.id === id)?.status ?? '')) return poll()
        followers.delete(id)
      })
      .catch(() => {
        if (valid())
          timers.set(
            id,
            setTimeout(() => void poll(), 3000),
          )
      })
  }
  async function open(id: string) {
    openVersion++
    stopFollowing()
    openController?.abort()
    const version = openVersion,
      generation = epoch,
      controller = new AbortController()
    openController = controller
    active.value = id
    current.value = undefined
    tasks.value = []
    older.value = ''
    error.value = null
    if (!id) {
      loading.value = false
      return
    }
    lastOpened.value = id
    loading.value = true
    try {
      const [row, page] = await Promise.all([
        images.conversation(id, controller.signal),
        images.tasks(
          new URLSearchParams({ conversation_id: id, limit: '50' }),
          false,
          controller.signal,
        ),
      ])
      if (version !== openVersion || generation !== epoch) return
      current.value = row
      upsertConversation(row)
      tasks.value = [...page.items].reverse()
      older.value = page.next_cursor
      if (row.model_id && models.items.image.some((m) => m.id === row.model_id))
        models.select('image', row.model_id)
      for (const task of tasks.value) if (!terminal(task.status)) follow(task.id)
    } catch (e) {
      if (!controller.signal.aborted && version === openVersion) error.value = e
    } finally {
      if (version === openVersion) loading.value = false
    }
  }
  async function loadOlder() {
    if (!active.value || !older.value || loading.value) return
    const version = openVersion
    loading.value = true
    try {
      const page = await images.tasks(
        new URLSearchParams({ conversation_id: active.value, cursor: older.value, limit: '50' }),
      )
      if (version !== openVersion) return
      const ids = new Set(tasks.value.map((t) => t.id))
      tasks.value = [...page.items.filter((t) => !ids.has(t.id)).reverse(), ...tasks.value]
      older.value = page.next_cursor
      for (const task of page.items) if (!terminal(task.status)) follow(task.id)
    } catch (e) {
      if (version === openVersion) error.value = e
    } finally {
      if (version === openVersion) loading.value = false
    }
  }
  async function submit(): Promise<string | undefined> {
    if (sending.value) return
    const generation = epoch
    const view = openVersion
    sending.value = true
    error.value = null
    try {
      if (!pending.value) {
        const d = draft.value,
          model = models.selected.image
        if (!d.prompt.trim() || !model) throw new ApiError('INVALID_INPUT')
        const id = active.value || crypto.randomUUID()
        pending.value = {
          input: {
            conversation_id: id,
            model_id: model,
            prompt: d.prompt.trim(),
            quality: d.quality,
            size: d.size,
            ratio: d.ratio,
            n: d.n,
            reference_file_ids: d.references.map((f) => f.id),
          },
          key: crypto.randomUUID(),
          create: !active.value,
        }
      }
      const submission = pending.value
      if (submission.create) {
        const row = await images.create(submission.input.conversation_id, submission.input.model_id)
        if (generation !== epoch) return
        upsertConversation(row)
      }
      const result = await images.submit(submission.input, submission.key)
      if (generation !== epoch) return
      pending.value = undefined
      if (view !== openVersion) {
        void refreshBalance()
        void list()
        return
      }
      const oldKey = active.value || 'new'
      if (oldKey === 'new' || active.value === result.conversation_id) {
        drafts[result.conversation_id] = { ...draft.value, prompt: '', references: [] }
        if (oldKey === 'new') delete drafts.new
      }
      if (active.value !== result.conversation_id) await open(result.conversation_id)
      else {
        accept(result)
        follow(result.id)
      }
      lastOpened.value = result.conversation_id
      void refreshBalance()
      void list()
      return result.conversation_id
    } catch (e) {
      if (generation === epoch) {
        error.value = e
        // Keep the exact key and payload when the server outcome is unknown.
        if (e instanceof ApiError && e.status > 0 && e.status < 500) pending.value = undefined
      }
    } finally {
      if (generation === epoch) sending.value = false
    }
  }
  async function cancel(row: ImageTask) {
    const generation = epoch
    try {
      const result = await images.cancel(row.id)
      if (generation === epoch) accept(result)
    } catch (e) {
      if (generation === epoch) error.value = e
    }
  }
  async function update(row: ImageConversation, title: string, pinned = row.pinned) {
    const generation = epoch
    try {
      const saved = await images.update(row, title, pinned)
      if (generation === epoch) upsertConversation(saved)
    } catch (e) {
      if (generation === epoch) error.value = e
    }
  }
  async function removeConversation(id: string) {
    const generation = epoch
    try {
      await images.removeConversation(id)
      if (generation !== epoch) return
      conversations.value = conversations.value.filter((c) => c.id !== id)
      Reflect.deleteProperty(drafts, id)
      if (lastOpened.value === id) lastOpened.value = ''
      if (active.value === id) await open('')
    } catch (e) {
      if (generation === epoch) error.value = e
    }
  }
  return {
    configuration,
    conversations,
    current,
    tasks,
    active,
    lastOpened,
    balance,
    loading,
    sending,
    error,
    listError,
    query,
    cursor,
    older,
    drafts,
    draft,
    pending,
    initialize,
    refreshBalance,
    list,
    open,
    loadOlder,
    submit,
    cancel,
    update,
    removeConversation,
    stopFollowing,
    reset,
  }
})
