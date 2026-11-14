import { canvases, type CanvasRunInput } from '../../../api/canvases'
import { images, terminal, type ImageTask } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { pendingTasks } from '../../../features/canvas/document'
import { applyTask, failTask } from '../../../features/canvas/tasks'
import type { Autosave } from './autosave'
import type { CanvasEditor } from './editor'

export type GenerationRequest = Omit<CanvasRunInput, 'version'>

export interface GenerationHooks {
  /** Called after a task is charged and again when it settles (credits, gallery). */
  changed(): void
  /** Test seam for retry waits. */
  wait?(ms: number): Promise<void>
}

const POLL_MS = 3000

/** Network failures leave the submission outcome unknown; the same key replays safely. */
export function unknownOutcome(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.code === 'NETWORK_ERROR' || error.status === 0 || error.status >= 500)
  )
}

/**
 * Runs generator nodes through the image task pipeline. Results land in pending slots
 * that follow the task over SSE (falling back to polling) and settle in every undo
 * snapshot, so undo never brings back a placeholder for a paid image.
 */
export function createCanvasGeneration(
  editor: CanvasEditor,
  autosave: Autosave,
  hooks: GenerationHooks,
) {
  const followers = new Map<string, AbortController>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const wait = hooks.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  let active = false
  let submitting = false
  const unresolved = new Map<string, { input: CanvasRunInput; key: string }>()

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
      const unsubscribe = editor.store.subscribe((state, previous) => {
        if (state.doc !== previous.doc) {
          for (const id of pendingTasks(state.doc)) follow(id)
        }
      })
      return () => {
        active = false
        unsubscribe()
        for (const id of [...followers.keys()]) stop(id)
      }
    },
    async submit(request: GenerationRequest): Promise<boolean> {
      if (!active || submitting) return false
      submitting = true
      try {
        const task = await autosave.submit(
          async (version) => {
            const pending = unresolved.get(request.node_id) ?? {
              input: { ...request, version },
              key: crypto.randomUUID(),
            }
            unresolved.set(request.node_id, pending)
            for (let attempt = 0; ; attempt++) {
              try {
                const result = await canvases.run(editor.state.canvasId, pending.input, pending.key)
                unresolved.delete(request.node_id)
                return result
              } catch (error) {
                if (!unknownOutcome(error)) {
                  unresolved.delete(request.node_id)
                  throw error
                }
                if (attempt >= 2 || !active) throw error
                await wait(1000 * (attempt + 1))
              }
            }
          },
          (board, accepted) => {
            if (!active) return
            const slots = board.document.nodes.filter((node) => node.image?.task_id === accepted.id)
            const byID = new Map(slots.map((node) => [node.id, node]))
            editor.apply((doc) => {
              const present = new Set(doc.nodes.map((node) => node.id))
              const appended = slots.filter((node) => !present.has(node.id))
              return {
                ...doc,
                nodes: [
                  ...doc.nodes.map((node) => {
                    const image = byID.get(node.id)?.image
                    return image ? { ...node, image } : node
                  }),
                  ...appended,
                ],
                edges: [
                  ...doc.edges,
                  ...board.document.edges.filter(
                    (edge) =>
                      edge.kind === 'result' &&
                      byID.has(edge.to) &&
                      !present.has(edge.to) &&
                      present.has(edge.from),
                  ),
                ],
              }
            })
          },
        )
        if (!task || !active) return !!task
        hooks.changed()
        accept(task)
        return true
      } catch (error) {
        if (active) editor.notify({ key: '', error })
        return false
      } finally {
        submitting = false
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
