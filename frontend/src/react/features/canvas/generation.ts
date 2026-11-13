import { images, terminal, type ImageInput, type ImageTask } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { capacity } from '../../../features/canvas/commands'
import { newId, pendingTasks } from '../../../features/canvas/document'
import { addResultSlots, applyTask, failTask } from '../../../features/canvas/tasks'
import { placeOutputs } from '../../../features/canvas/workflow'
import type { CanvasEditor } from './editor'

export interface GenerationRequest {
  generator: string
  modelId: string
  prompt: string
  quality: ImageInput['quality']
  size: string
  ratio: string
  n: number
  references: readonly string[]
  /** Width / height of the requested size, used to shape placeholders. */
  aspect: number
}

export interface GenerationHooks {
  /** Called after a task is charged and again when it settles (credits, gallery). */
  changed(): void
  /** Test seam for retry waits. */
  wait?(ms: number): Promise<void>
}

const POLL_MS = 3000

/** Network failures leave the submission outcome unknown; the same key replays safely. */
function unknownOutcome(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.code === 'NETWORK_ERROR' || error.status === 0 || [502, 503, 504].includes(error.status))
  )
}

/**
 * Runs generator nodes through the image task pipeline. Results land in pending slots
 * that follow the task over SSE (falling back to polling) and settle in every undo
 * snapshot, so undo never brings back a placeholder for a paid image.
 */
export function createCanvasGeneration(editor: CanvasEditor, hooks: GenerationHooks) {
  const followers = new Map<string, AbortController>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const wait = hooks.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  let active = false

  function stop(id: string) {
    followers.get(id)?.abort()
    followers.delete(id)
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  function accept(task: ImageTask) {
    if (!active) return
    editor.addFiles(task.items.flatMap((item) => (item.file ? [item.file] : [])))
    editor.patchEverywhere((doc) => applyTask(doc, task))
    if (terminal(task.status)) {
      stop(task.id)
      hooks.changed()
    }
  }

  function follow(id: string) {
    if (!active || followers.has(id)) return
    const controller = new AbortController()
    followers.set(id, controller)
    const live = () => active && !controller.signal.aborted
    const later = (delay: number) => {
      if (live())
        timers.set(
          id,
          setTimeout(() => void poll(), delay),
        )
    }
    const poll = async () => {
      if (!live()) return
      try {
        const task = await images.task(id, false, controller.signal)
        if (!live()) return
        accept(task)
        if (terminal(task.status)) return
      } catch (error) {
        if (!live()) return
        if (error instanceof ApiError && [403, 404].includes(error.status)) {
          editor.patchEverywhere((doc) => failTask(doc, id, 'IMAGE_TASK_NOT_FOUND'))
          stop(id)
          return
        }
      }
      later(POLL_MS)
    }
    images
      .events(id, controller.signal, (task) => {
        if (live()) accept(task)
      })
      .then(
        () => later(0),
        () => later(POLL_MS),
      )
  }

  return {
    /** Follows every task with pending slots until the cleanup runs. */
    mount() {
      active = true
      for (const id of pendingTasks(editor.state.doc)) follow(id)
      return () => {
        active = false
        for (const id of [...followers.keys()]) stop(id)
      }
    },
    /**
     * Submits one task for a generator. Placeholders show where results will land until
     * the server accepts the task; returns false when nothing was charged.
     */
    async submit(request: GenerationRequest): Promise<boolean> {
      if (!active) return false
      const state = editor.state
      const generator = state.doc.nodes.find((node) => node.id === request.generator)
      if (!generator) return false
      if (capacity(state.doc) < request.n) {
        editor.notify({ key: 'canvas.editor.limit' })
        return false
      }
      const placeholders = placeOutputs(state.doc, generator, request.n, request.aspect).map(
        (rect) => ({ id: newId(), kind: 'submit' as const, rect }),
      )
      editor.addPlaceholders(placeholders)
      const input: ImageInput = {
        conversation_id: state.conversationId,
        model_id: request.modelId,
        prompt: request.prompt,
        quality: request.quality,
        size: request.size,
        n: request.n,
        reference_file_ids: [...request.references],
        ...(request.ratio ? { ratio: request.ratio } : {}),
      }
      const key = crypto.randomUUID()
      try {
        let task: ImageTask | undefined
        for (let attempt = 0; !task; attempt++) {
          try {
            task = await images.submit(input, key)
          } catch (error) {
            if (attempt >= 2 || !unknownOutcome(error) || !active) throw error
            await wait(1000 * (attempt + 1))
          }
        }
        if (!active) return true
        const accepted = task
        editor.removePlaceholders(placeholders.map((item) => item.id))
        editor.apply((doc) => {
          const owner = doc.nodes.find((node) => node.id === request.generator) ?? generator
          const slots = placeOutputs(doc, owner, request.n, request.aspect)
          return addResultSlots(doc, request.generator, accepted, slots, newId)
        })
        hooks.changed()
        accept(accepted)
        if (!terminal(accepted.status)) follow(accepted.id)
        return true
      } catch (error) {
        if (!active) return false
        editor.removePlaceholders(placeholders.map((item) => item.id))
        editor.notify({ key: '', error })
        return false
      }
    },
    async cancel(id: string) {
      try {
        accept(await images.cancel(id))
      } catch (error) {
        editor.notify({ key: '', error })
      }
    },
  }
}

export type CanvasGeneration = ReturnType<typeof createCanvasGeneration>
