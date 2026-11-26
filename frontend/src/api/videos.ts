import type { components } from './schema'
import { authorized } from './protected'
import { parsePublicModel, parseVideoProfile } from './catalog-contracts'
import { ApiError, record } from './transport'

type S = components['schemas']
export type VideoAsset = S['VideoAsset']
export type VideoInput = S['VideoInput']
export type VideoOption = S['VideoOption']
export type VideoProfile = S['VideoProfile']
export type VideoPricing = S['VideoPricing']
export type VideoQuote = S['VideoQuote']
export type VideoSubmission = S['VideoSubmission']
export type VideoTask = S['VideoTask']
export type VideoCreditPool = S['VideoCreditPool']
export type VideoResolution = S['VideoResolution']
export type VideoReference = S['VideoRef']

export const videoModes = ['text', 'first_frame', 'first_last', 'reference'] as const
export const videoRoles = [
  'first_frame',
  'last_frame',
  'reference_image',
  'reference_video',
  'reference_audio',
] as const
export const videoResolutions = ['480p', '720p', '768p', '1080p', '2k', '4k'] as const
const pools = ['video', 'permanent'] as const
const billing = ['second', 'clip'] as const
const root = '/api/v1'

const invalid = () => new ApiError('RESPONSE_INVALID')
const text = (v: unknown): string => {
  if (typeof v !== 'string') throw invalid()
  return v
}
const int = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw invalid()
  return v
}
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw invalid()
  return v
}
const list = <T>(v: unknown, parse: (value: unknown) => T): T[] => {
  if (!Array.isArray(v)) throw invalid()
  return v.map(parse)
}
const choice = <const T extends readonly string[]>(v: unknown, values: T): T[number] => {
  const value = text(v)
  if (!values.includes(value)) throw invalid()
  return value as T[number]
}
const page = <T>(v: unknown, parse: (value: unknown) => T) => {
  const row = record(v)
  return { next_cursor: text(row.next_cursor), items: list(row.items, parse) }
}
export function parseVideoInput(value: unknown): VideoInput {
  const row = record(value)
  return {
    model_id: text(row.model_id),
    mode: choice(row.mode, videoModes),
    ratio: text(row.ratio),
    resolution: choice(row.resolution, videoResolutions),
    count: int(row.count),
    duration_seconds: int(row.duration_seconds),
    generate_audio: bool(row.generate_audio),
    prompt: text(row.prompt),
    references:
      row.references === null
        ? []
        : list(row.references, (value) => {
            const ref = record(value)
            return {
              file_id: text(ref.file_id),
              role: choice(ref.role, videoRoles),
              ...(ref.token === undefined ? {} : { token: text(ref.token) }),
            }
          }),
  }
}
export function parseVideoQuote(value: unknown): VideoQuote {
  const row = record(value)
  return {
    pool: choice(row.pool, pools),
    mode: choice(row.mode, billing),
    unit_price: int(row.unit_price),
    total_cost: int(row.total_cost),
    count: int(row.count),
    pricing_version: int(row.pricing_version),
    pool_version: int(row.pool_version),
  }
}
function parsePricing(value: unknown): VideoPricing {
  const row = record(value)
  return {
    model_id: text(row.model_id),
    mode: choice(row.mode, billing),
    version: int(row.version),
    rates: list(row.rates, (value) => {
      const rate = record(value)
      return {
        resolution: choice(rate.resolution, videoResolutions),
        has_video_reference: bool(rate.has_video_reference),
        credits: int(rate.credits),
        ...(rate.duration_seconds === undefined
          ? {}
          : { duration_seconds: int(rate.duration_seconds) }),
      }
    }),
  }
}
export function parseVideoTask(value: unknown): VideoTask {
  const row = record(value)
  return {
    id: text(row.id),
    model_name: text(row.model_name),
    input: parseVideoInput(row.input),
    quote: parseVideoQuote(row.quote),
    status: choice(row.status, ['queued', 'running', 'succeeded', 'partial', 'failed']),
    refunded: int(row.refunded),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
    ...(row.canvas_id === undefined ? {} : { canvas_id: text(row.canvas_id) }),
    items: list(row.items, (value) => {
      const part = record(value)
      return {
        position: int(part.position),
        status: choice(part.status, ['queued', 'running', 'succeeded', 'failed']),
        ...(part.file_id === undefined ? {} : { file_id: text(part.file_id) }),
        ...(part.error_code === undefined ? {} : { error_code: text(part.error_code) }),
      }
    }),
  }
}
function parseAsset(value: unknown): VideoAsset {
  const row = record(value),
    url = text(row.url),
    id = text(row.id)
  if (!url.startsWith('/api/v1/video-media/' + id + '/play?')) throw invalid()
  return {
    id,
    url,
    kind: choice(row.kind, [
      'upload',
      'generated',
      'video_upload',
      'video_generated',
      'audio_upload',
    ]),
    mime: text(row.mime),
    width: int(row.width),
    height: int(row.height),
    size: int(row.size),
    duration_ms: int(row.duration_ms),
    created_at: text(row.created_at),
  }
}
function parsePool(value: unknown): VideoCreditPool {
  const row = record(value)
  return { pool: choice(row.pool, pools), version: int(row.version) }
}
const signalOption = (signal?: AbortSignal) => (signal ? { signal } : {})
const cursorQuery = (cursor: string) => new URLSearchParams({ cursor })
export const videoAPI = {
  protocols: (signal?: AbortSignal) =>
    authorized(
      root + '/admin/video-protocols',
      (value) =>
        list(record(value).items, (item) => {
          const row = record(item)
          return { protocol: text(row.protocol), profiles: list(row.profiles, text) }
        }),
      signalOption(signal),
    ),
  options: (signal?: AbortSignal) =>
    authorized(
      root + '/video-options',
      (v) =>
        list(record(v).items, (value): VideoOption => {
          const row = record(value)
          return {
            model: parsePublicModel(row.model),
            profiles: list(row.profiles, parseVideoProfile),
            pricing: parsePricing(row.pricing),
          }
        }),
      signalOption(signal),
    ),
  quote: (body: VideoInput) =>
    authorized(root + '/video-tasks/quote', parseVideoQuote, { method: 'POST', body }),
  submit: (body: VideoSubmission, idempotencyKey: string) =>
    authorized(root + '/video-tasks', parseVideoTask, { method: 'POST', body, idempotencyKey }),
  task: (id: string, signal?: AbortSignal) =>
    authorized(
      root + '/video-tasks/' + encodeURIComponent(id),
      parseVideoTask,
      signalOption(signal),
    ),
  tasks: (cursor = '', signal?: AbortSignal) =>
    authorized(
      root + '/video-tasks?' + cursorQuery(cursor),
      (v) => page(v, parseVideoTask),
      signalOption(signal),
    ),
  assets: (cursor = '', signal?: AbortSignal) =>
    authorized(
      root + '/video-assets?' + cursorQuery(cursor),
      (v) => page(v, parseAsset),
      signalOption(signal),
    ),
  asset: (id: string, signal?: AbortSignal) =>
    authorized(root + '/video-assets/' + encodeURIComponent(id), parseAsset, signalOption(signal)),
  upload: (file: File, kind: 'video' | 'audio' | 'image') =>
    authorized(root + '/video-assets?kind=' + kind, parseAsset, { method: 'POST', raw: file }),
  pool: (signal?: AbortSignal) =>
    authorized(root + '/video-credit-pool', parsePool, signalOption(signal)),
  savePool: (body: VideoCreditPool) =>
    authorized(root + '/admin/video-credit-pool', parsePool, { method: 'PUT', body }),
  pricing: (model: string, signal?: AbortSignal) =>
    authorized(
      root + '/admin/video-pricing/' + encodeURIComponent(model),
      parsePricing,
      signalOption(signal),
    ),
  savePricing: (body: VideoPricing) =>
    authorized(root + '/admin/video-pricing/' + encodeURIComponent(body.model_id), parsePricing, {
      method: 'PUT',
      body,
    }),
}
export const videoPending = (status: VideoTask['status']) =>
  status === 'queued' || status === 'running'
