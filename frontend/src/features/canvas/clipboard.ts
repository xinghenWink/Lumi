import type { CanvasDocument } from '../../api/canvases'
import { parseDocument } from '../../api/canvases'
import { documentProblem, LIMITS } from './document'
import type { Fragment } from './commands'

/**
 * Canvas fragments travel through the system clipboard as tagged text, so copy and paste
 * work across canvases and tabs without browser clipboard permissions or shared state.
 */
const PREFIX = 'lumi-canvas/v1:'

export function encodeFragment(fragment: Fragment) {
  return PREFIX + JSON.stringify({ nodes: fragment.nodes, edges: fragment.edges })
}

/** Returns a validated fragment, or null for unrelated or tampered clipboard text. */
export function decodeFragment(text: string): Fragment | null {
  if (!text.startsWith(PREFIX) || text.length > LIMITS.documentBytes) return null
  try {
    const raw: unknown = JSON.parse(text.slice(PREFIX.length))
    const doc: CanvasDocument = parseDocument({
      schema: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      ...(typeof raw === 'object' && raw !== null ? raw : {}),
    })
    if (!doc.nodes.length || documentProblem(doc)) return null
    return { nodes: doc.nodes, edges: doc.edges }
  } catch {
    return null
  }
}
