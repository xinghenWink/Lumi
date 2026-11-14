import { createStore } from 'zustand/vanilla'
import type { Canvas, CanvasDocument } from '../../../api/canvases'
import { ApiError } from '../../../api/transport'
import { documentProblem } from '../../../features/canvas/document'
import type { CanvasEditor } from './editor'

export type SaveStatus =
  'saved' | 'dirty' | 'saving' | 'retrying' | 'conflict' | 'invalid' | 'missing'

export interface SaveBody {
  title: string
  document: CanvasDocument
  version: number
}

export interface AutosaveOptions {
  save(body: SaveBody): Promise<Canvas>
  load(): Promise<Canvas>
  /** Delay after a document edit. */
  editDelay?: number
  /** Delay after viewport-only changes, which matter less and happen continuously. */
  viewDelay?: number
  /** Backoff after failures; the last entry repeats. */
  retryDelays?: readonly number[]
}

/**
 * Saves the editor's document with optimistic versioning: one request in flight, edits
 * made meanwhile trigger a follow-up save, failures back off, and a version conflict
 * pauses saving until the user picks a side.
 */
export function createAutosave(editor: CanvasEditor, options: AutosaveOptions) {
  const editDelay = options.editDelay ?? 1200,
    viewDelay = options.viewDelay ?? 4000,
    retryDelays = options.retryDelays ?? [2000, 5000, 15000]
  const status = createStore<{ status: SaveStatus; error: unknown }>(() => ({
    status: 'saved',
    error: null,
  }))
  let saved = { revision: editor.state.revision, view: editor.state.viewRevision }
  let timer: ReturnType<typeof setTimeout> | undefined
  let due = Infinity
  let inflight: Promise<void> | null = null
  let running = false
  let failures = 0
  let active = false
  let discarded = false

  const set = (value: SaveStatus, error: unknown = null) =>
    status.setState({ status: value, error })
  // An invalid document retries on the next edit; conflicts and deletion need the user.
  const blocked = () => ['conflict', 'missing'].includes(status.getState().status)
  const pending = () => {
    const state = editor.state
    return state.revision !== saved.revision || state.viewRevision !== saved.view
  }

  function schedule(delay: number) {
    if (!active || discarded || blocked()) return
    const at = Date.now() + delay
    if (timer && at >= due) return
    if (timer) clearTimeout(timer)
    due = at
    timer = setTimeout(() => {
      timer = undefined
      due = Infinity
      void flush()
    }, delay)
  }

  async function send() {
    const state = editor.state
    const document = { ...state.doc, viewport: state.viewport }
    if (documentProblem(document)) {
      set('invalid')
      return
    }
    const sending = { revision: state.revision, view: state.viewRevision }
    set('saving')
    try {
      const result = await options.save({ title: state.title, document, version: state.version })
      editor.adopt(result)
      saved = sending
      failures = 0
      if (pending()) {
        set('dirty')
        schedule(editDelay)
      } else set('saved')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CANVAS_CONFLICT') set('conflict', error)
      else if (error instanceof ApiError && error.status === 404) set('missing', error)
      else if (error instanceof ApiError && error.status === 400) set('invalid', error)
      else {
        set('retrying', error)
        const delay = retryDelays[Math.min(failures, retryDelays.length - 1)] ?? 15000
        failures += 1
        schedule(delay)
      }
    }
  }

  /** Saves now if anything changed; resolves once no save is running. */
  async function flush(): Promise<void> {
    if (blocked() || running || discarded) return
    if (timer) {
      clearTimeout(timer)
      timer = undefined
      due = Infinity
    }
    if (inflight) {
      await inflight
      if (pending()) return flush()
      return
    }
    if (!pending()) return
    inflight = send().finally(() => {
      inflight = null
    })
    await inflight
  }

  const watch = () =>
    editor.store.subscribe((state, previous) => {
      if (state.revision !== previous.revision && state.revision !== saved.revision) {
        if (!inflight && !blocked()) set('dirty')
        schedule(editDelay)
      } else if (state.viewRevision !== previous.viewRevision) schedule(viewDelay)
    })

  return {
    status,
    flush,
    pending,
    discard() {
      discarded = true
      if (timer) clearTimeout(timer)
      timer = undefined
      due = Infinity
    },
    /** Document edits not yet saved; viewport moves alone do not warrant a leave prompt. */
    unsaved: () => editor.state.revision !== saved.revision,
    async submit<T>(
      request: (version: number) => Promise<{ canvas: Canvas; task: T }>,
      apply: (canvas: Canvas, task: T) => void,
    ): Promise<T | undefined> {
      if (running) return undefined
      await flush()
      if (running || blocked() || pending()) return undefined
      running = true
      const version = editor.state.version
      try {
        const result = await request(version)
        if (result.canvas.version !== version + 1) {
          set('conflict')
          return result.task
        }
        const clean = !pending()
        const previousView = saved.view
        editor.adopt(result.canvas)
        apply(result.canvas, result.task)
        if (clean) {
          saved = { revision: editor.state.revision, view: previousView }
          set('saved')
        }
        return result.task
      } catch (error) {
        if (error instanceof ApiError && error.code === 'CANVAS_CONFLICT') set('conflict', error)
        throw error
      } finally {
        running = false
        if (pending()) schedule(editDelay)
      }
    },
    /** Conflict resolution: adopt the server copy, or keep local edits over it. */
    async resolve(side: 'theirs' | 'mine') {
      const latest = await options.load()
      if (side === 'theirs') {
        editor.replace(latest)
        saved = { revision: editor.state.revision, view: editor.state.viewRevision }
        set('saved')
        return
      }
      editor.adopt(latest)
      set('dirty')
      await flush()
    },
    /**
     * Starts watching edits. The cleanup saves what is pending and stops watching; React
     * StrictMode may run it and mount again.
     */
    mount() {
      active = true
      const unsubscribe = watch()
      if (pending()) schedule(editDelay)
      return () => {
        unsubscribe()
        active = false
        void flush()
      }
    },
  }
}

export type Autosave = ReturnType<typeof createAutosave>
