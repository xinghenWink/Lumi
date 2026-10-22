import type { components } from './schema'
import { authorized, authorizedResponse } from './protected'
import { ApiError, noContent, record } from './transport'
import { parsePage } from './catalog-contracts'
type S = components['schemas']
export type ImageFile = S['ImageFile']
export type ImageTask = S['ImageTask']
export type ImageInput = S['ImageTaskInput']
export type ImageConversation = S['ImageConversation']
export type ImageConfiguration = S['ImageConfiguration']
export type GalleryItem = S['ImageGalleryItem']
export type ImagePage<T> = { items: T[]; next_cursor: string }
const str = (v: unknown): string => {
  if (typeof v !== 'string') throw new ApiError('RESPONSE_INVALID')
  return v
}
const num = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    throw new ApiError('RESPONSE_INVALID')
  return v
}
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new ApiError('RESPONSE_INVALID')
  return v
}
const nullable = (v: unknown) => (v === null ? null : str(v))
const list = <T>(v: unknown, parse: (v: unknown) => T): T[] => {
  if (!Array.isArray(v)) throw new ApiError('RESPONSE_INVALID')
  return v.map(parse)
}
const choice = <const T extends readonly string[]>(v: unknown, choices: T): T[number] => {
  const value = str(v)
  if (!choices.includes(value)) throw new ApiError('RESPONSE_INVALID')
  return value as T[number]
}
export function parseFile(v: unknown): ImageFile {
  const d = record(v)
  const url = (v: unknown) => {
    const value = str(v)
    if (!/^\/api\/v1\/files\/[0-9a-f-]+(?:\/thumb)?\?/.test(value))
      throw new ApiError('RESPONSE_INVALID')
    return value
  }
  return {
    id: str(d.id),
    kind: choice(d.kind, ['upload', 'generated', 'thumbnail', 'avatar']),
    mime: choice(d.mime, ['image/png']),
    size: num(d.size),
    width: num(d.width),
    height: num(d.height),
    thumbnail_width: num(d.thumbnail_width),
    thumbnail_height: num(d.thumbnail_height),
    url: url(d.url),
    thumbnail_url: url(d.thumbnail_url),
    expires_at: num(d.expires_at),
    created_at: str(d.created_at),
  }
}
export function parseImageConversation(v: unknown): ImageConversation {
  const d = record(v)
  return {
    id: str(d.id),
    title: str(d.title),
    model_id: nullable(d.model_id),
    pinned: bool(d.pinned),
    version: num(d.version),
    created_at: str(d.created_at),
    last_message_at: str(d.last_message_at),
  }
}
export function parseImageConfiguration(v: unknown): ImageConfiguration {
  const d = record(v),
    ratios = record(d.ratio_sizes)
  return {
    max_n: num(d.max_n),
    max_references: num(d.max_references),
    max_upload_bytes: num(d.max_upload_bytes),
    sizes: list(d.sizes, str),
    ratio_sizes: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, str(v)])),
    per_user_concurrency: num(d.per_user_concurrency),
    global_concurrency: num(d.global_concurrency),
    timeout_seconds: num(d.timeout_seconds),
    queue_timeout_seconds: num(d.queue_timeout_seconds),
    split_requests: bool(d.split_requests),
    retention_days: num(d.retention_days),
    admin_can_view_content: bool(d.admin_can_view_content),
    version: num(d.version),
  }
}
export function parseTask(v: unknown): ImageTask {
  const d = record(v)
  return {
    id: str(d.id),
    user_id: str(d.user_id),
    conversation_id: str(d.conversation_id),
    model_id: str(d.model_id),
    model_name: str(d.model_name),
    prompt: str(d.prompt),
    operation: choice(d.operation, ['generate', 'edit']),
    quality: choice(d.quality, ['low', 'medium', 'high']),
    size: str(d.size),
    ratio: str(d.ratio),
    n: num(d.n),
    reference_file_ids: list(d.reference_file_ids, str),
    unit_price: num(d.unit_price),
    total_cost: num(d.total_cost),
    refunded_cost: num(d.refunded_cost),
    actual_cost: num(d.actual_cost),
    status: choice(d.status, ['queued', 'running', 'succeeded', 'partial', 'failed', 'canceled']),
    successful_images: num(d.successful_images),
    queue_position: num(d.queue_position),
    cancel_requested: bool(d.cancel_requested),
    error_code: str(d.error_code),
    started_at: nullable(d.started_at),
    finished_at: nullable(d.finished_at),
    created_at: str(d.created_at),
    version: num(d.version),
    content_visible: bool(d.content_visible),
    items: list(d.items, (v) => {
      const i = record(v)
      return {
        position: num(i.position),
        status: choice(i.status, ['pending', 'succeeded', 'failed']),
        file_id: nullable(i.file_id),
        file: i.file === null ? null : parseFile(i.file),
        error_code: str(i.error_code),
      }
    }),
  }
}
export function parseGallery(v: unknown): GalleryItem {
  const d = record(v)
  return {
    file: parseFile(d.file),
    task_id: str(d.task_id),
    conversation_id: str(d.conversation_id),
    model_id: str(d.model_id),
    model_name: str(d.model_name),
    prompt: str(d.prompt),
    quality: choice(d.quality, ['low', 'medium', 'high']),
    size: str(d.size),
    ratio: str(d.ratio),
    status: str(d.status),
    unit_price: num(d.unit_price),
  }
}
export const terminal = (status: string) =>
  ['succeeded', 'partial', 'failed', 'canceled'].includes(status)
export async function consumeImageEvents(response: Response, onTask: (task: ImageTask) => void) {
  if (!response.headers.get('Content-Type')?.startsWith('text/event-stream') || !response.body)
    throw new ApiError('RESPONSE_INVALID')
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = '',
    done = false
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      if (buffer.length > 2_200_000) throw new ApiError('RESPONSE_INVALID')
      let match = buffer.match(/\r?\n\r?\n/)
      while (match?.index !== undefined) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const lines = frame.split(/\r?\n/),
          type = lines
            .find((l) => l.startsWith('event:'))
            ?.slice(6)
            .trim()
        const data = lines
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n')
        if (data && type !== 'ping') {
          if (done || (type !== 'task' && type !== 'done')) throw new ApiError('RESPONSE_INVALID')
          const v = record(JSON.parse(data))
          onTask(parseTask(v.task))
          done = type === 'done'
        }
        match = buffer.match(/\r?\n\r?\n/)
      }
      if (chunk.done) break
    }
    if (!done) throw new ApiError('NETWORK_ERROR')
  } finally {
    if (!done) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
const root = '/api/v1',
  conv = (id: string) => root + '/image-conversations/' + encodeURIComponent(id)
const task = (id: string, admin = false) =>
  root + (admin ? '/admin' : '') + '/image-tasks/' + encodeURIComponent(id)
const signalOptions = (signal?: AbortSignal) => (signal ? { signal } : {})
export const images = {
  options: (admin = false, signal?: AbortSignal) =>
    authorized(
      root + (admin ? '/admin/image-settings' : '/image-options'),
      parseImageConfiguration,
      signalOptions(signal),
    ),
  saveOptions: (body: ImageConfiguration) =>
    authorized(root + '/admin/image-settings', parseImageConfiguration, { method: 'PUT', body }),
  conversations: (q: URLSearchParams, signal?: AbortSignal) =>
    authorized(
      root + '/image-conversations?' + q,
      (v) => parsePage(v, parseImageConversation),
      signalOptions(signal),
    ),
  conversation: (id: string, signal?: AbortSignal) =>
    authorized(conv(id), parseImageConversation, signalOptions(signal)),
  create: (id: string, model_id: string) =>
    authorized(root + '/image-conversations', parseImageConversation, {
      method: 'POST',
      body: { id, model_id },
    }),
  update: (row: ImageConversation, title: string, pinned = row.pinned) =>
    authorized(conv(row.id), parseImageConversation, {
      method: 'PATCH',
      body: { title, pinned, version: row.version },
    }),
  removeConversation: (id: string) => authorized(conv(id), noContent, { method: 'DELETE' }),
  submit: (body: ImageInput, key: string) =>
    authorized(root + '/image-tasks', parseTask, { method: 'POST', body, idempotencyKey: key }),
  task: (id: string, admin = false, signal?: AbortSignal) =>
    authorized(task(id, admin), parseTask, signalOptions(signal)),
  tasks: (q: URLSearchParams, admin = false, signal?: AbortSignal) =>
    authorized(
      root + (admin ? '/admin' : '') + '/image-tasks?' + q,
      (v) => parsePage(v, parseTask),
      signalOptions(signal),
    ),
  cancel: (id: string) => authorized(task(id) + '/cancel', parseTask, { method: 'POST' }),
  events: async (id: string, signal: AbortSignal, onTask: (task: ImageTask) => void) =>
    consumeImageEvents(await authorizedResponse(task(id) + '/events', { signal }), onTask),
  upload: (file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file)
    return authorized(root + '/files', parseFile, {
      method: 'POST',
      form,
      ...signalOptions(signal),
    })
  },
  file: (id: string, signal?: AbortSignal) =>
    authorized(
      root + '/files/' + encodeURIComponent(id) + '/metadata',
      parseFile,
      signalOptions(signal),
    ),
  library: (q: URLSearchParams, signal?: AbortSignal) =>
    authorized(root + '/me/files?' + q, (v) => parsePage(v, parseFile), signalOptions(signal)),
  gallery: (q: URLSearchParams, signal?: AbortSignal) =>
    authorized(root + '/me/images?' + q, (v) => parsePage(v, parseGallery), signalOptions(signal)),
  removeFile: (id: string, admin = false) =>
    authorized(root + (admin ? '/admin' : '/me') + '/images/' + encodeURIComponent(id), noContent, {
      method: 'DELETE',
    }),
  quote: (body: S['CreditQuoteInput'], signal?: AbortSignal) =>
    authorized(
      root + '/me/credits/quote',
      (v) => {
        const d = record(v)
        return { unit_price: num(d.unit_price), total_cost: num(d.total_cost), count: num(d.count) }
      },
      { method: 'POST', body, ...signalOptions(signal) },
    ),
  blob: async (file: ImageFile, thumbnail = false, signal?: AbortSignal) => {
    let current = file
    // Owners can refresh an expired signature without changing the file identity.
    if (current.expires_at <= Date.now() / 1000 + 5) current = await images.file(file.id, signal)
    const response = await authorizedResponse(
      thumbnail ? current.thumbnail_url : current.url,
      signalOptions(signal),
    )
    if (
      response.headers.get('Content-Type')?.split(';')[0] !==
      (thumbnail ? 'image/webp' : 'image/png')
    )
      throw new ApiError('RESPONSE_INVALID')
    return response.blob()
  },
}
