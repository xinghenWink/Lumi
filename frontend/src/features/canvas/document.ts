import type {
  CanvasDocument,
  CanvasEdge,
  CanvasGeneratorContent,
  CanvasImageContent,
  CanvasNode,
  CanvasNodeKind,
} from '../../api/canvases'

/** Mirrors backend/internal/canvas/document.go; the server remains the authority. */
export const LIMITS = {
  nodes: 500,
  edges: 1000,
  title: 100,
  text: 8000,
  prompt: 8000,
  coordinate: 1_000_000,
  minSize: 24,
  maxSize: 20_000,
  minZoom: 0.05,
  maxZoom: 4,
  count: 10,
  documentBytes: 1 << 20,
} as const

export const DEFAULT_SIZE: Record<CanvasNodeKind, { w: number; h: number }> = {
  image: { w: 280, h: 280 },
  video: { w: 320, h: 180 },
  text: { w: 260, h: 140 },
  generator: { w: 320, h: 236 },
  group: { w: 480, h: 360 },
}

export type IdFactory = () => string
export const newId: IdFactory = () => crypto.randomUUID()

export function emptyDocument(): CanvasDocument {
  return { schema: 2, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))
export const clampCoordinate = (value: number) =>
  clamp(value, -LIMITS.coordinate, LIMITS.coordinate)
export const clampSize = (value: number) => clamp(value, LIMITS.minSize, LIMITS.maxSize)

interface Placement {
  x: number
  y: number
  w?: number
  h?: number
}
function frame(kind: CanvasNodeKind, at: Placement, id: string) {
  return {
    id,
    kind,
    x: clampCoordinate(at.x),
    y: clampCoordinate(at.y),
    w: clampSize(at.w ?? DEFAULT_SIZE[kind].w),
    h: clampSize(at.h ?? DEFAULT_SIZE[kind].h),
    title: '',
    group_id: null,
  }
}

export function imageNode(
  at: Placement,
  image: Partial<CanvasImageContent> & Pick<CanvasImageContent, 'state'>,
  id = newId(),
): CanvasNode {
  return {
    ...frame('image', at, id),
    image: { file_id: null, task_id: null, position: null, error_code: '', ...image },
  }
}

export function videoNode(at: Placement, id = newId()): CanvasNode {
  return {
    ...frame('video', at, id),
    video: { state: 'empty', file_id: null, task_id: null, position: null, error_code: '' },
  }
}

/** Sizes an image node to the file's aspect ratio within a bounding box. */
export function fitImage(width: number, height: number, box = 320) {
  if (width <= 0 || height <= 0) return { w: box, h: box }
  const scale = box / Math.max(width, height)
  return { w: clampSize(width * scale), h: clampSize(height * scale) }
}

export function textNode(at: Placement, content = '', id = newId()): CanvasNode {
  return { ...frame('text', at, id), text: { content } }
}

export function generatorNode(
  at: Placement,
  generator: Partial<CanvasGeneratorContent> = {},
  id = newId(),
): CanvasNode {
  return {
    ...frame('generator', at, id),
    generator: { prompt: '', model_id: null, quality: '', size: '', ratio: '', n: 1, ...generator },
  }
}

export function groupNode(at: Placement, title = '', id = newId()): CanvasNode {
  return { ...frame('group', at, id), title }
}

export function canGenerate(node: CanvasNode | undefined) {
  return (
    node?.kind === 'generator' ||
    (node?.kind === 'text' && node.text?.state !== 'pending') ||
    (!!node?.image && node.image.state !== 'pending')
  )
}

export function connectable(
  from: CanvasNodeKind | undefined,
  to: CanvasNodeKind | undefined,
  kind: CanvasEdge['kind'],
) {
  if (kind === 'result')
    return (
      ((from === 'image' || from === 'generator') && to === 'image') ||
      (from === 'text' && to === 'text') ||
      (from === 'video' && to === 'video')
    )
  if (to === 'video') return from === 'image' || from === 'text' || from === 'video'
  return (
    (from === 'image' || from === 'text' || from === 'group') &&
    (to === 'image' || to === 'generator' || to === 'text')
  )
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sizePattern = /^(auto|[1-9][0-9]{1,4}x[1-9][0-9]{1,4})$/
const ratioPattern = /^(auto|[1-9][0-9]{0,2}:[1-9][0-9]{0,2})$/
const codePattern = /^[A-Z0-9_]{0,64}$/
// eslint-disable-next-line no-control-regex -- the server rejects these control characters.
const titleControl = /[\u0000-\u001f\u007f-\u009f]/
// eslint-disable-next-line no-control-regex -- multiline text keeps tab, LF and CR only.
const textControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
const runes = (value: string) => [...value].length
const finite = (value: number) => Number.isFinite(value)
const inCoordinate = (value: number) => finite(value) && Math.abs(value) <= LIMITS.coordinate
const inSize = (value: number) =>
  finite(value) && value >= LIMITS.minSize && value <= LIMITS.maxSize

function nodeProblem(node: CanvasNode, kinds: Map<string, CanvasNodeKind>): string {
  if (!inCoordinate(node.x) || !inCoordinate(node.y) || !inSize(node.w) || !inSize(node.h))
    return 'geometry'
  if (runes(node.title) > LIMITS.title || titleControl.test(node.title)) return 'title'
  if (node.group_id !== null && (node.kind === 'group' || kinds.get(node.group_id) !== 'group'))
    return 'group'
  const settings = node.text_settings
  if (
    settings &&
    (node.kind !== 'text' ||
      !validPrompt(settings) ||
      settings.n < 1 ||
      settings.n > 3 ||
      !Number.isInteger(settings.n) ||
      (settings.model_id !== null && !uuid.test(settings.model_id)))
  )
    return 'text'
  const parts = [node.image, node.text, node.generator, node.video].filter(
    (part) => part !== undefined,
  )
  if (node.kind === 'group') return parts.length ? 'content' : ''
  if (node.kind === 'image' ? !node.image || !!node.text || !!node.video : parts.length !== 1)
    return 'content'
  if (node.kind === 'text') {
    const text = node.text
    if (
      text?.state &&
      (!text.run_id ||
        !uuid.test(text.run_id) ||
        text.position === undefined ||
        text.position < 0 ||
        text.position > 2 ||
        !codePattern.test(text.error_code ?? '') ||
        (text.state !== 'failed' && text.error_code))
    )
      return 'text'
    const content = text?.content
    return content !== undefined && runes(content) <= LIMITS.text && !textControl.test(content)
      ? ''
      : 'text'
  }
  if (node.kind === 'generator' || node.generator) {
    const g = node.generator
    if (!g || !validPrompt(g)) return 'prompt'
    if (g.model_id !== null && !uuid.test(g.model_id)) return 'model'
    if ((g.size && !sizePattern.test(g.size)) || (g.ratio && !ratioPattern.test(g.ratio)))
      return 'size'
    if (!Number.isInteger(g.n) || g.n < 1 || g.n > LIMITS.count) return 'count'
    if (node.kind === 'generator') return ''
  }
  const image = node.kind === 'video' ? node.video : node.image
  if (!image || !codePattern.test(image.error_code)) return 'image'
  if (
    image.position !== null &&
    (image.position < 0 || image.position >= (node.kind === 'video' ? 4 : LIMITS.count))
  )
    return 'position'
  if (image.position !== null && image.task_id === null) return 'position'
  if (image.state === 'empty')
    return image.file_id || image.task_id || image.error_code ? 'image' : ''
  if (image.state === 'ready') return image.file_id && !image.error_code ? '' : 'image'
  if (image.state === 'pending')
    return !image.file_id && image.task_id && image.position !== null && !image.error_code
      ? ''
      : 'image'
  return image.file_id ? 'image' : ''
}

function validPrompt(settings: Pick<CanvasGeneratorContent, 'prompt' | 'mentions'>) {
  const mentions = settings.mentions ?? []
  return (
    runes(settings.prompt) <= LIMITS.prompt &&
    !textControl.test(settings.prompt) &&
    mentions.length <= LIMITS.nodes &&
    new Set(mentions.map((mention) => mention.token)).size === mentions.length &&
    mentions.every(
      (mention) =>
        uuid.test(mention.node_id) &&
        /^@\[[^[\]\r\n]{1,50}\]$/u.test(mention.token) &&
        settings.prompt.includes(mention.token),
    )
  )
}

/** Returns the first problem the server would reject, or an empty string. */
export function documentProblem(doc: CanvasDocument): string {
  const { viewport } = doc
  if (doc.schema !== 2) return 'schema'
  if (
    !inCoordinate(viewport.x) ||
    !inCoordinate(viewport.y) ||
    !(viewport.zoom >= LIMITS.minZoom && viewport.zoom <= LIMITS.maxZoom)
  )
    return 'viewport'
  if (doc.nodes.length > LIMITS.nodes || doc.edges.length > LIMITS.edges) return 'size'
  const kinds = new Map<string, CanvasNodeKind>()
  for (const node of doc.nodes) {
    if (!uuid.test(node.id) || kinds.has(node.id)) return 'node-id'
    kinds.set(node.id, node.kind)
  }
  for (const node of doc.nodes) {
    const problem = nodeProblem(node, kinds)
    if (problem) return problem
  }
  const edges = new Set<string>(),
    pairs = new Set<string>()
  for (const edge of doc.edges) {
    const pair = edgeKey(edge)
    if (!uuid.test(edge.id) || edges.has(edge.id)) return 'edge-id'
    if (edge.from === edge.to || pairs.has(pair)) return 'edge'
    if (!connectable(kinds.get(edge.from), kinds.get(edge.to), edge.kind)) return 'edge'
    edges.add(edge.id)
    pairs.add(pair)
  }
  return ''
}

export function nodeMap(doc: CanvasDocument) {
  return new Map(doc.nodes.map((node) => [node.id, node]))
}

export function fileIds(doc: CanvasDocument) {
  const ids = new Set<string>()
  for (const node of doc.nodes) if (node.image?.file_id) ids.add(node.image.file_id)
  return [...ids]
}

export function pendingTasks(doc: CanvasDocument) {
  const ids = new Set<string>()
  for (const node of doc.nodes)
    if (node.image?.state === 'pending' && node.image.task_id) ids.add(node.image.task_id)
  return [...ids]
}

export function edgeKey(edge: Pick<CanvasEdge, 'from' | 'to' | 'kind'>) {
  return edge.from + '>' + edge.to + ':' + edge.kind
}
