import type { components } from './schema'
import { ApiError, record } from './transport'
type Schema = components['schemas']
export type Upstream = Schema['Upstream']
export type UpstreamInput = Schema['UpstreamInput']
export type PlatformModel = Schema['PlatformModel']
export type ModelInput = Schema['PlatformModelInput']
export type PublicModel = Schema['PublicModel']
export type Capabilities = Schema['ModelCapabilities']
export type RouteInput = Schema['ModelRouteInput']
export type ModelKind = PublicModel['type']
export type ImportInput = Schema['UpstreamImportInput']
export type Discovery = Schema['UpstreamDiscovery']
export type ConnectionTest = Schema['UpstreamConnectionTest']
function text(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value !== 'string') throw new ApiError('RESPONSE_INVALID')
  return value
}
function bool(data: Record<string, unknown>, key: string): boolean {
  const value = data[key]
  if (typeof value !== 'boolean') throw new ApiError('RESPONSE_INVALID')
  return value
}
function integer(
  data: Record<string, unknown>,
  key: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = data[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new ApiError('RESPONSE_INVALID')
  return value
}
function choice<const T extends readonly string[]>(
  data: Record<string, unknown>,
  key: string,
  values: T,
): T[number] {
  const value = text(data, key)
  if (!values.includes(value)) throw new ApiError('RESPONSE_INVALID')
  return value as T[number]
}
function list<T>(data: Record<string, unknown>, key: string, parse: (value: unknown) => T): T[] {
  const value = data[key]
  if (!Array.isArray(value)) throw new ApiError('RESPONSE_INVALID')
  return value.map(parse)
}
const parseText = (value: unknown) => {
  if (typeof value !== 'string') throw new ApiError('RESPONSE_INVALID')
  return value
}
export function parseCapabilities(value: unknown): Capabilities {
  const data = record(value)
  const qualities = list(data, 'qualities', (value) => {
    if (value !== 'low' && value !== 'medium' && value !== 'high')
      throw new ApiError('RESPONSE_INVALID')
    return value
  })
  return {
    vision: bool(data, 'vision'),
    stream: bool(data, 'stream'),
    max_context_tokens: integer(data, 'max_context_tokens', 0, 1000000),
    qualities,
    sizes: list(data, 'sizes', parseText),
    max_n: integer(data, 'max_n', 0, 10),
    supports_edit: bool(data, 'supports_edit'),
    max_reference_images: integer(data, 'max_reference_images', 0, 4),
    response_format: choice(data, 'response_format', ['', 'b64_json', 'url'] as const),
  }
}
export function parseUpstream(value: unknown): Upstream {
  const d = record(value)
  return {
    ...(d.circuit_state !== undefined
      ? {
          circuit_state: choice(d, 'circuit_state', ['closed', 'open', 'half_open'] as const),
          consecutive_failures: integer(d, 'consecutive_failures'),
          last_error: text(d, 'last_error'),
          open_until: d.open_until === null ? null : text(d, 'open_until'),
        }
      : {}),
    id: text(d, 'id'),
    version: integer(d, 'version', 1),
    name: text(d, 'name'),
    base_url: text(d, 'base_url'),
    api_key_configured: bool(d, 'api_key_configured'),
    timeout_chat_s: integer(d, 'timeout_chat_s', 1, 600),
    timeout_image_s: integer(d, 'timeout_image_s', 1, 600),
    proxy_url: text(d, 'proxy_url'),
    enabled: bool(d, 'enabled'),
    priority: integer(d, 'priority', 0, 10000),
    weight: integer(d, 'weight', 1, 10000),
    edit_format: choice(d, 'edit_format', ['multipart', 'json'] as const),
    note: text(d, 'note'),
    created_at: text(d, 'created_at'),
    updated_at: text(d, 'updated_at'),
  }
}
export function parsePublicModel(value: unknown): PublicModel {
  const d = record(value)
  return {
    id: text(d, 'id'),
    display_name: text(d, 'display_name'),
    type: choice(d, 'type', ['chat', 'image'] as const),
    description: text(d, 'description'),
    icon: text(d, 'icon'),
    sort_order: integer(d, 'sort_order', 0, 10000),
    is_default: bool(d, 'is_default'),
    capabilities: parseCapabilities(d.capabilities),
  }
}
export function parseModel(value: unknown): PlatformModel {
  const d = record(value)
  return {
    ...parsePublicModel(d),
    version: integer(d, 'version', 1),
    enabled: bool(d, 'enabled'),
    created_at: text(d, 'created_at'),
    updated_at: text(d, 'updated_at'),
    routes: list(d, 'routes', (value) => {
      const route = record(value)
      return {
        id: text(route, 'id'),
        upstream_id: text(route, 'upstream_id'),
        upstream_model_name: text(route, 'upstream_model_name'),
        priority: integer(route, 'priority', 0, 10000),
        weight: integer(route, 'weight', 1, 10000),
        enabled: bool(route, 'enabled'),
        upstream_name: text(route, 'upstream_name'),
        upstream_enabled: bool(route, 'upstream_enabled'),
      }
    }),
  }
}
export function parsePage<T>(value: unknown, parse: (value: unknown) => T) {
  const d = record(value)
  return { items: list(d, 'items', parse), next_cursor: text(d, 'next_cursor') }
}
export const parseUpstreams = (value: unknown) => parsePage(value, parseUpstream)
export const parseModels = (value: unknown) => parsePage(value, parseModel)
export const parsePublicCatalog = (value: unknown) => ({
  items: list(record(value), 'items', parsePublicModel),
})
export const parseImportResult = (value: unknown) => ({
  items: list(record(value), 'items', parseModel),
})
export function parseDiscovery(value: unknown): Discovery {
  const d = record(value)
  return {
    upstream_id: text(d, 'upstream_id'),
    version: integer(d, 'version', 1),
    models: list(d, 'models', (value) => ({ id: text(record(value), 'id') })),
  }
}
export function parseConnectionTest(value: unknown): ConnectionTest {
  const d = record(value)
  return {
    success: bool(d, 'success'),
    latency_ms: integer(d, 'latency_ms'),
    status: integer(d, 'status', 0, 999),
    error_code: text(d, 'error_code'),
    model_count: integer(d, 'model_count', 0, 1000),
  }
}
export function defaultCapabilities(kind: ModelKind): Capabilities {
  return {
    vision: false,
    stream: kind === 'chat',
    max_context_tokens: kind === 'chat' ? 4096 : 0,
    qualities: kind === 'image' ? ['low'] : [],
    sizes: kind === 'image' ? ['1024x1024'] : [],
    max_n: kind === 'image' ? 1 : 0,
    supports_edit: false,
    max_reference_images: 0,
    response_format: kind === 'image' ? 'b64_json' : '',
  }
}
