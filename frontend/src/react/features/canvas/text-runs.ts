import { canvases, type CanvasTextRun, type CanvasTextRunInput } from '../../../api/canvases'
import { ApiError } from '../../../api/transport'
import type { Autosave } from './autosave'
import type { CanvasEditor } from './editor'
import { unknownOutcome } from './generation'

export function createCanvasTextRuns(editor: CanvasEditor, autosave: Autosave) {
  const watchers = new Map<string, AbortController>()
  const retries = new Map<string, { body: CanvasTextRunInput; key: string }>()
  let active = false

  function settle(run: CanvasTextRun) {
    editor.patchEverywhere((doc) => {
      let changed = false
      const nodes = doc.nodes.map((node) => {
        const text = node.text
        if (text?.state !== 'pending' || text.run_id !== run.id) return node
        const item = run.items.find((candidate) => candidate.position === text.position)
        if (!item || item.status === 'queued' || item.status === 'running') return node
        changed = true
        if (item.status === 'succeeded')
          return { ...node, text: { ...text, state: 'ready' as const, content: item.content } }
        return { ...node, text: { ...text, state: 'failed' as const, error_code: item.error_code } }
      })
      return changed ? { ...doc, nodes } : doc
    })
  }

  function follow(id: string) {
    if (watchers.has(id)) return
    const controller = new AbortController()
    watchers.set(id, controller)
    const poll = async () => {
      if (controller.signal.aborted || !active) return
      try {
        const result = await canvases.textRun(editor.state.canvasId, id, controller.signal)
        if (controller.signal.aborted || !active) return
        settle(result)
        if (result.items.every((item) => item.status !== 'queued' && item.status !== 'running')) {
          watchers.delete(id)
          return
        }
      } catch (error) {
        if (controller.signal.aborted || !active) return
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          settle({
            id,
            items: [0, 1, 2].map((position) => ({
              position,
              status: 'failed',
              content: '',
              error_code: 'CHAT_INTERRUPTED',
            })),
          })
          watchers.delete(id)
          return
        }
      }
      setTimeout(() => void poll(), 1200)
    }
    void poll()
  }

  return {
    mount() {
      active = true
      const scan = () => {
        for (const node of editor.state.doc.nodes) {
          if (node.text?.state === 'pending' && node.text.run_id) follow(node.text.run_id)
        }
      }
      scan()
      const stop = editor.store.subscribe((next, before) => {
        if (next.doc !== before.doc) scan()
      })
      return () => {
        active = false
        stop()
        for (const controller of watchers.values()) controller.abort()
        watchers.clear()
      }
    },
    async submit(input: Omit<CanvasTextRunInput, 'version'>) {
      try {
        const response = await autosave.submit(
          async (version) => {
            const pending = retries.get(input.node_id) ?? {
              body: { ...input, version },
              key: crypto.randomUUID(),
            }
            retries.set(input.node_id, pending)
            for (let attempt = 0; ; attempt++) {
              try {
                const result = await canvases.runText(
                  editor.state.canvasId,
                  pending.body,
                  pending.key,
                )
                retries.delete(input.node_id)
                return result
              } catch (error) {
                if (!unknownOutcome(error)) {
                  retries.delete(input.node_id)
                  throw error
                }
                if (attempt >= 2 || !active) throw error
                await new Promise<void>((done) => setTimeout(done, 1000 * (attempt + 1)))
              }
            }
          },
          (board, run) => {
            if (!active) return
            const slots = new Map(
              board.document.nodes
                .filter((node) => node.text?.run_id === run.id)
                .map((node) => [node.id, node]),
            )
            editor.apply((doc) => {
              const present = new Set(doc.nodes.map((node) => node.id))
              const added = [...slots.values()].filter((node) => !present.has(node.id))
              return {
                ...doc,
                nodes: [
                  ...doc.nodes.map((node) => {
                    const text = slots.get(node.id)?.text
                    return text ? { ...node, text } : node
                  }),
                  ...added,
                ],
                edges: [
                  ...doc.edges,
                  ...board.document.edges.filter(
                    (edge) =>
                      edge.kind === 'result' &&
                      slots.has(edge.to) &&
                      !present.has(edge.to) &&
                      present.has(edge.from),
                  ),
                ],
              }
            })
          },
        )
        if (response && active) settle(response)
      } catch (error) {
        if (active) editor.notify({ key: '', error })
      }
    },
    async cancel(id: string) {
      try {
        settle(await canvases.cancelText(editor.state.canvasId, id))
      } catch (error) {
        if (active) editor.notify({ key: '', error })
      }
    },
  }
}
