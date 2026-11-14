import type { CanvasDocument, CanvasEdge, CanvasNode } from '../../api/canvases'
import {
  clampCoordinate,
  clampSize,
  canGenerate,
  connectable,
  edgeKey,
  groupNode,
  LIMITS,
  newId,
  nodeMap,
  type IdFactory,
} from './document'
import { boundsOf, contains, type Rect } from './geometry'

/** Room left before the document reaches the node limit. */
export const capacity = (doc: CanvasDocument) => LIMITS.nodes - doc.nodes.length

export function addNodes(doc: CanvasDocument, nodes: readonly CanvasNode[]): CanvasDocument {
  if (!nodes.length || nodes.length > capacity(doc)) return doc
  return { ...doc, nodes: [...doc.nodes, ...nodes] }
}

export function updateNode(
  doc: CanvasDocument,
  id: string,
  change: (node: CanvasNode) => CanvasNode,
): CanvasDocument {
  let changed = false
  const nodes = doc.nodes.map((node) => {
    if (node.id !== id) return node
    const next = change(node)
    changed ||= next !== node
    return next
  })
  return changed ? { ...doc, nodes } : doc
}

/** Moving a group frame carries its members with it. */
export function withMembers(doc: CanvasDocument, ids: Iterable<string>) {
  const result = new Set(ids)
  for (const node of doc.nodes) if (node.group_id && result.has(node.group_id)) result.add(node.id)
  return result
}

export function moveNodes(
  doc: CanvasDocument,
  ids: Iterable<string>,
  dx: number,
  dy: number,
): CanvasDocument {
  if (!dx && !dy) return doc
  const moving = withMembers(doc, ids)
  if (!moving.size) return doc
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      moving.has(node.id)
        ? { ...node, x: clampCoordinate(node.x + dx), y: clampCoordinate(node.y + dy) }
        : node,
    ),
  }
}

export function resizeNode(doc: CanvasDocument, id: string, rect: Rect): CanvasDocument {
  return updateNode(doc, id, (node) => ({
    ...node,
    x: clampCoordinate(rect.x),
    y: clampCoordinate(rect.y),
    w: clampSize(rect.w),
    h: clampSize(rect.h),
  }))
}

/** Keeps the aspect ratio of the original rectangle while following the pointer. */
export function aspectResize(original: Rect, w: number, h: number): Rect {
  const ratio = original.w / original.h
  const width = Math.max(w, h * ratio)
  return { ...original, w: clampSize(width), h: clampSize(width / ratio) }
}

/** Removing a group frame keeps its members; dangling edges are dropped. */
export function removeNodes(doc: CanvasDocument, ids: Iterable<string>): CanvasDocument {
  const removed = new Set(ids)
  if (!removed.size) return doc
  return {
    ...doc,
    nodes: doc.nodes
      .filter((node) => !removed.has(node.id))
      .map((node) =>
        node.group_id && removed.has(node.group_id) ? { ...node, group_id: null } : node,
      ),
    edges: doc.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to)),
  }
}

export function removeEdges(doc: CanvasDocument, ids: Iterable<string>): CanvasDocument {
  const removed = new Set(ids)
  if (!removed.size) return doc
  return { ...doc, edges: doc.edges.filter((edge) => !removed.has(edge.id)) }
}

export function canConnect(doc: CanvasDocument, from: string, to: string) {
  if (from === to || doc.edges.length >= LIMITS.edges) return false
  const nodes = nodeMap(doc)
  const source = nodes.get(from)
  const target = nodes.get(to)
  if (!canGenerate(target) || !connectable(source?.kind, target?.kind, 'input')) return false
  if (source?.kind === 'image' && source.image?.state !== 'ready') return false
  if (source?.text?.state === 'pending') return false
  return !doc.edges.some((edge) => edge.kind === 'input' && edge.from === from && edge.to === to)
}

export function connect(
  doc: CanvasDocument,
  from: string,
  to: string,
  id = newId(),
): CanvasDocument {
  if (!canConnect(doc, from, to)) return doc
  return { ...doc, edges: [...doc.edges, { id, from, to, kind: 'input' }] }
}

/** Wraps the selected non-group nodes in a new frame with room for its title. */
export function groupNodes(
  doc: CanvasDocument,
  ids: Iterable<string>,
  title: string,
  id = newId(),
): { doc: CanvasDocument; group: string | null } {
  const selected = new Set(ids)
  const members = doc.nodes.filter((node) => selected.has(node.id) && node.kind !== 'group')
  const bounds = boundsOf(members)
  if (!bounds || capacity(doc) < 1) return { doc, group: null }
  const padding = 24,
    header = 36
  const frame = groupNode(
    {
      x: bounds.x - padding,
      y: bounds.y - padding - header,
      w: bounds.w + padding * 2,
      h: bounds.h + padding * 2 + header,
    },
    title,
    id,
  )
  const memberIds = new Set(members.map((node) => node.id))
  return {
    group: id,
    doc: {
      ...doc,
      // Frames go first so they paint beneath everything added before them.
      nodes: [
        frame,
        ...doc.nodes.map((node) => (memberIds.has(node.id) ? { ...node, group_id: id } : node)),
      ],
    },
  }
}

export function ungroup(doc: CanvasDocument, ids: Iterable<string>): CanvasDocument {
  const nodes = nodeMap(doc)
  const groups = [...ids].filter((id) => nodes.get(id)?.kind === 'group')
  return groups.length ? removeNodes(doc, groups) : doc
}

/**
 * After a drag, a node belongs to the frontmost group frame containing its center, so
 * dropping a node into or out of a frame updates membership like a design tool.
 */
export function reparent(doc: CanvasDocument, ids: Iterable<string>): CanvasDocument {
  const moved = new Set(ids)
  const groups = doc.nodes.filter((node) => node.kind === 'group' && !moved.has(node.id))
  let changed = false
  const nodes = doc.nodes.map((node) => {
    if (!moved.has(node.id) || node.kind === 'group') return node
    const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 }
    let owner: string | null = null
    for (const group of groups) if (contains(group, center)) owner = group.id
    if (owner === node.group_id) return node
    changed = true
    return { ...node, group_id: owner }
  })
  return changed ? { ...doc, nodes } : doc
}

/** Moves nodes to the end of paint order (frames still paint beneath other kinds). */
export function bringToFront(doc: CanvasDocument, ids: Iterable<string>): CanvasDocument {
  const front = new Set(ids)
  const raised = doc.nodes.filter((node) => front.has(node.id))
  if (!raised.length) return doc
  return { ...doc, nodes: [...doc.nodes.filter((node) => !front.has(node.id)), ...raised] }
}

export interface Fragment {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** Copies selected nodes (with group members) and the edges fully inside the selection. */
export function extractFragment(doc: CanvasDocument, ids: Iterable<string>): Fragment {
  const picked = withMembers(doc, ids)
  const kept = new Set(
    doc.nodes
      .filter(
        (node) =>
          picked.has(node.id) && node.image?.state !== 'pending' && node.text?.state !== 'pending',
      )
      .map((node) => node.id),
  )
  // A member copied without its frame becomes a free node.
  const nodes = doc.nodes
    .filter((node) => kept.has(node.id))
    .map((node) => (node.group_id && !kept.has(node.group_id) ? { ...node, group_id: null } : node))
  return {
    nodes,
    edges: doc.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  }
}

/**
 * Inserts a fragment with fresh IDs. Pasted images keep their file but drop task links,
 * which belong to the source canvas conversation.
 */
export function insertFragment(
  doc: CanvasDocument,
  fragment: Fragment,
  offset: { x: number; y: number },
  makeId: IdFactory = newId,
): { doc: CanvasDocument; ids: string[] } {
  if (!fragment.nodes.length || fragment.nodes.length > capacity(doc)) return { doc, ids: [] }
  const ids = new Map(fragment.nodes.map((node) => [node.id, makeId()]))
  const nodes = fragment.nodes.map((node): CanvasNode => {
    const copy: CanvasNode = {
      ...node,
      id: ids.get(node.id) ?? makeId(),
      x: clampCoordinate(node.x + offset.x),
      y: clampCoordinate(node.y + offset.y),
      group_id: node.group_id ? (ids.get(node.group_id) ?? null) : null,
    }
    if (node.image) copy.image = { ...node.image, task_id: null, position: null }
    if (node.text) copy.text = { content: node.text.content }
    for (const settings of ['generator', 'text_settings'] as const) {
      const value = copy[settings]
      if (!value?.mentions) continue
      const mentions = value.mentions.map((mention) => ({
        ...mention,
        node_id: ids.get(mention.node_id) ?? mention.node_id,
      }))
      if (settings === 'generator' && copy.generator)
        copy.generator = { ...copy.generator, mentions }
      if (settings === 'text_settings' && copy.text_settings)
        copy.text_settings = { ...copy.text_settings, mentions }
    }
    return copy
  })
  const existing = new Set(doc.edges.map(edgeKey))
  const edges: CanvasEdge[] = []
  for (const edge of fragment.edges) {
    const from = ids.get(edge.from),
      to = ids.get(edge.to)
    if (!from || !to) continue
    const copy = { id: makeId(), from, to, kind: edge.kind }
    if (!existing.has(edgeKey(copy))) edges.push(copy)
  }
  const groups = nodes.filter((node) => node.kind === 'group'),
    others = nodes.filter((node) => node.kind !== 'group')
  return {
    ids: nodes.map((node) => node.id),
    doc: {
      ...doc,
      nodes: [...groups, ...doc.nodes, ...others],
      edges: [...doc.edges, ...edges].slice(0, LIMITS.edges),
    },
  }
}

const CASCADE = 32

/**
 * Shifts a new node down and right while its center lands on another node's center,
 * so repeated inserts at the same spot stay visible instead of stacking exactly.
 */
export function cascade<T extends Rect>(doc: CanvasDocument, rect: T): T {
  const centers = doc.nodes.map((node) => ({ x: node.x + node.w / 2, y: node.y + node.h / 2 }))
  let next = rect
  for (let step = 0; step < 50; step++) {
    const cx = next.x + next.w / 2,
      cy = next.y + next.h / 2
    if (!centers.some((center) => Math.abs(center.x - cx) < 8 && Math.abs(center.y - cy) < 8))
      return next
    next = { ...next, x: next.x + CASCADE, y: next.y + CASCADE }
  }
  return next
}
