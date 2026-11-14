import type { CanvasDocument, CanvasNode } from '../../api/canvases'
import { DEFAULT_SIZE, generatorNode, LIMITS, newId, nodeMap, type IdFactory } from './document'
import { addNodes } from './commands'
import { boundsOf } from './geometry'

export interface GenerationInputs {
  /** Reference file IDs in connection order, without duplicates. */
  references: string[]
  texts: string[]
  /** Connected images that are still pending, failed or unavailable. */
  unavailable: number
}

/** Group members are read top-to-bottom, then left-to-right. */
function members(doc: CanvasDocument, group: string) {
  return doc.nodes.filter((node) => node.group_id === group).sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * Walks the generator's incoming edges: images become references and text joins the
 * prompt; a connected group contributes its members in reading order.
 */
export function collectInputs(
  doc: CanvasDocument,
  generator: string,
  available: (fileId: string) => boolean = () => true,
): GenerationInputs {
  const nodes = nodeMap(doc)
  const result: GenerationInputs = { references: [], texts: [], unavailable: 0 }
  const seen = new Set<string>()
  const seenNodes = new Set([generator])
  const take = (node: CanvasNode | undefined) => {
    if (!node || seenNodes.has(node.id)) return
    seenNodes.add(node.id)
    if (node.kind === 'text') {
      const text = node.text?.content.trim()
      if (text) result.texts.push(text)
    } else if (node.kind === 'image') {
      const file = node.image?.state === 'ready' ? node.image.file_id : null
      if (!file || !available(file)) result.unavailable += 1
      else if (!seen.has(file)) {
        seen.add(file)
        result.references.push(file)
      }
    }
  }
  for (const edge of doc.edges) {
    if (edge.to !== generator || edge.kind !== 'input') continue
    const source = nodes.get(edge.from)
    if (source?.kind === 'group') members(doc, source.id).forEach(take)
    else take(source)
  }
  return result
}

/** Connected text follows the generator's own prompt, one paragraph each. */
export function buildPrompt(prompt: string, texts: readonly string[]) {
  return [prompt.trim(), ...texts].filter(Boolean).join('\n\n')
}

const GENERATOR_GAP = 96

/**
 * Creates a generator to the right of the selection and connects every usable selected
 * node to it. Returns the new generator ID, or null when nothing can feed it.
 */
export function generatorFromSelection(
  doc: CanvasDocument,
  ids: Iterable<string>,
  makeId: IdFactory = newId,
): { doc: CanvasDocument; generator: string | null } {
  const selected = new Set(ids)
  const inputs = doc.nodes.filter(
    (node) =>
      selected.has(node.id) &&
      (node.image?.state === 'ready' || node.kind === 'text' || node.kind === 'group') &&
      // Members of a selected group already arrive through the group itself.
      !(node.group_id && selected.has(node.group_id)),
  )
  const bounds = boundsOf(inputs)
  if (!bounds || doc.edges.length + inputs.length > LIMITS.edges) return { doc, generator: null }
  const size = DEFAULT_SIZE.generator
  const id = makeId()
  const node = generatorNode(
    { x: bounds.x + bounds.w + GENERATOR_GAP, y: bounds.y + bounds.h / 2 - size.h / 2 },
    {},
    id,
  )
  const next = addNodes(doc, [node])
  if (next === doc) return { doc, generator: null }
  return {
    generator: id,
    doc: {
      ...next,
      edges: [
        ...next.edges,
        ...inputs.map((input) => ({
          id: makeId(),
          from: input.id,
          to: id,
          kind: 'input' as const,
        })),
      ],
    },
  }
}
