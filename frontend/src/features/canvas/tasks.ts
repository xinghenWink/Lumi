import type { CanvasDocument, CanvasNode } from '../../api/canvases'
import type { ImageTask } from '../../api/images'
import { terminal } from '../../api/images'
import { clampSize, imageNode } from './document'
import type { Rect } from './geometry'

/** Pending result slots for a freshly accepted task, connected to their generator. */
export function addResultSlots(
  doc: CanvasDocument,
  generator: string,
  task: Pick<ImageTask, 'id'>,
  slots: readonly Rect[],
  makeId: () => string,
): CanvasDocument {
  const nodes = slots.map((slot, position) =>
    imageNode(slot, { state: 'pending', task_id: task.id, position }, makeId()),
  )
  const owner = doc.nodes.some((node) => node.id === generator)
  return {
    ...doc,
    nodes: [...doc.nodes, ...nodes],
    edges: owner
      ? [...doc.edges, ...nodes.map((node) => ({ id: makeId(), from: generator, to: node.id }))]
      : doc.edges,
  }
}

function settle(node: CanvasNode, task: ImageTask): CanvasNode {
  const image = node.image
  if (!image || image.state !== 'pending' || image.task_id !== task.id) return node
  const item = task.items.find((entry) => entry.position === image.position)
  if (item?.status === 'succeeded' && item.file_id) {
    const file = item.file
    // Keep the width the user sees and follow the real aspect ratio.
    const h = file && file.width > 0 ? clampSize((node.w * file.height) / file.width) : node.h
    return {
      ...node,
      h,
      image: { ...image, state: 'ready', file_id: item.file_id, error_code: '' },
    }
  }
  if (item?.status === 'failed' || terminal(task.status)) {
    const code = item?.error_code || task.error_code || 'IMAGE_TASK_CANCELED'
    return { ...node, image: { ...image, state: 'failed', error_code: safeCode(code) } }
  }
  return node
}

const safeCode = (code: string) =>
  /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'IMAGE_GENERATION_FAILED'

/** Moves pending slots of a task to ready or failed; untouched documents are returned as is. */
export function applyTask(doc: CanvasDocument, task: ImageTask): CanvasDocument {
  let changed = false
  const nodes = doc.nodes.map((node) => {
    const next = settle(node, task)
    changed ||= next !== node
    return next
  })
  return changed ? { ...doc, nodes } : doc
}

/** Fails every pending slot of a task the client can no longer follow. */
export function failTask(doc: CanvasDocument, taskId: string, code: string): CanvasDocument {
  let changed = false
  const nodes = doc.nodes.map((node) => {
    const image = node.image
    if (!image || image.state !== 'pending' || image.task_id !== taskId) return node
    changed = true
    return { ...node, image: { ...image, state: 'failed' as const, error_code: safeCode(code) } }
  })
  return changed ? { ...doc, nodes } : doc
}
