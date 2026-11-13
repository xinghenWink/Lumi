import type { components } from './schema'
import { authorized } from './protected'
import { ApiError, noContent, record } from './transport'
import { parseFile } from './images'

type S = components['schemas']
export type Canvas = S['Canvas']
export type CanvasSummary = S['CanvasSummary']
export type CanvasPage = S['CanvasPage']
export type CanvasDocument = S['CanvasDocument']
export type CanvasNode = S['CanvasNode']
export type CanvasEdge = S['CanvasEdge']
export type CanvasViewport = S['CanvasViewport']
export type CanvasImageContent = S['CanvasImageContent']
export type CanvasGeneratorContent = S['CanvasGeneratorContent']
export type CanvasNodeKind = CanvasNode['kind']

const invalid = () => new ApiError('RESPONSE_INVALID')
const str = (v: unknown): string => {
  if (typeof v !== 'string') throw invalid()
  return v
}
const int = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw invalid()
  return v
}
const real = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid()
  return v
}
const nullableText = (v: unknown) => (v === null ? null : str(v))
const nullableInt = (v: unknown) => (v === null ? null : int(v))
const list = <T>(v: unknown, parse: (v: unknown) => T): T[] => {
  if (!Array.isArray(v)) throw invalid()
  return v.map(parse)
}
const choice = <const T extends readonly string[]>(v: unknown, choices: T): T[number] => {
  const value = str(v)
  if (!choices.includes(value)) throw invalid()
  return value as T[number]
}

function parseNode(v: unknown): CanvasNode {
  const d = record(v)
  const node: CanvasNode = {
    id: str(d.id),
    kind: choice(d.kind, ['image', 'text', 'generator', 'group']),
    x: real(d.x),
    y: real(d.y),
    w: real(d.w),
    h: real(d.h),
    title: str(d.title),
    group_id: nullableText(d.group_id),
  }
  if (d.image !== undefined) {
    const i = record(d.image)
    node.image = {
      state: choice(i.state, ['ready', 'pending', 'failed']),
      file_id: nullableText(i.file_id),
      task_id: nullableText(i.task_id),
      position: nullableInt(i.position),
      error_code: str(i.error_code),
    }
  }
  if (d.text !== undefined) node.text = { content: str(record(d.text).content) }
  if (d.generator !== undefined) {
    const g = record(d.generator)
    node.generator = {
      prompt: str(g.prompt),
      model_id: nullableText(g.model_id),
      quality: choice(g.quality, ['', 'low', 'medium', 'high']),
      size: str(g.size),
      ratio: str(g.ratio),
      n: int(g.n),
    }
  }
  return node
}

export function parseDocument(v: unknown): CanvasDocument {
  const d = record(v),
    viewport = record(d.viewport)
  if (d.schema !== 1) throw invalid()
  return {
    schema: 1,
    viewport: { x: real(viewport.x), y: real(viewport.y), zoom: real(viewport.zoom) },
    nodes: list(d.nodes, parseNode),
    edges: list(d.edges, (value) => {
      const e = record(value)
      return { id: str(e.id), from: str(e.from), to: str(e.to) }
    }),
  }
}

export function parseCanvas(v: unknown): Canvas {
  const d = record(v)
  return {
    id: str(d.id),
    title: str(d.title),
    conversation_id: str(d.conversation_id),
    document: parseDocument(d.document),
    files: list(d.files, parseFile),
    node_count: int(d.node_count),
    version: int(d.version),
    created_at: str(d.created_at),
    updated_at: str(d.updated_at),
  }
}

export function parseCanvasSummary(v: unknown): CanvasSummary {
  const d = record(v)
  return {
    id: str(d.id),
    title: str(d.title),
    node_count: int(d.node_count),
    cover: d.cover === null ? null : parseFile(d.cover),
    version: int(d.version),
    created_at: str(d.created_at),
    updated_at: str(d.updated_at),
  }
}

export function parseCanvasPage(v: unknown): CanvasPage {
  const d = record(v)
  return { items: list(d.items, parseCanvasSummary), next_cursor: str(d.next_cursor) }
}

const root = '/api/v1/canvases'
const one = (id: string) => root + '/' + encodeURIComponent(id)
const signalOptions = (signal?: AbortSignal) => (signal ? { signal } : {})

export const canvases = {
  list: (q: URLSearchParams, signal?: AbortSignal) =>
    authorized(root + '?' + q, parseCanvasPage, signalOptions(signal)),
  create: (id: string, title = '') =>
    authorized(root, parseCanvas, { method: 'POST', body: { id, title } }),
  get: (id: string, signal?: AbortSignal) =>
    authorized(one(id), parseCanvas, signalOptions(signal)),
  save: (
    id: string,
    body: { title: string; document: CanvasDocument; version: number },
    signal?: AbortSignal,
  ) => authorized(one(id), parseCanvas, { method: 'PUT', body, ...signalOptions(signal) }),
  remove: (id: string) => authorized(one(id), noContent, { method: 'DELETE' }),
}
