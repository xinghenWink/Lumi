import { authorized, authorizedResponse } from './protected'
import { ApiError, record, noContent, request } from './transport'

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  instructions: string
  image_quality: 'low' | 'medium' | 'high'
  image_ratio: string
  image_count: number
}
export interface Device {
  id: string
  device: string
  ip: string
  user_agent: string
  created_at: string
  expires_at: string
}
export interface Announcement {
  id: string
  content: string
  starts_at: string
  ends_at: string | null
  enabled: boolean
  version: number
  created_at: string
}
export interface OperationsSettings {
  maintenance: boolean
  turnstile_enabled: boolean
  turnstile_site_key: string
  turnstile_hostname: string
  turnstile_secret_configured: boolean
  register_per_ip_day: number
  circuit_failures: number
  circuit_seconds: number
  sensitive_words: string[]
}
export interface Day {
  signup_credits: number
  daily_credits: number
  redeem_credits: number
  admin_credits: number
  date: string
  new_users: number
  active_users: number
  chat_messages: number
  image_success: number
  image_failed: number
  credits_granted: number
  credits_spent: number
}
export interface Dashboard {
  users: number
  active_streams: number
  credit_changes: number
  days: Day[]
  upstreams: { id: string; calls: number; successes: number; latency_ms: number }[]
}
export interface SystemInfo {
  version: string
  commit: string
  build_time: string
  uptime_seconds: number
  database_ok: boolean
  redis_ok: boolean
  image_bytes: number
}
export interface ChatMetadata {
  id: string
  user_id: string
  model_id: string | null
  last_message_at: string
  created_at: string
  busy: boolean
}
export interface Page<T> {
  items: T[]
  next_cursor: string
}
export const text = (v: unknown): string => {
  if (typeof v !== 'string') throw new ApiError('RESPONSE_INVALID')
  return v
}
export const integer = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    throw new ApiError('RESPONSE_INVALID')
  return v
}
export const boolean = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new ApiError('RESPONSE_INVALID')
  return v
}
function array<T>(v: unknown, parse: (x: unknown) => T): T[] {
  if (!Array.isArray(v)) throw new ApiError('RESPONSE_INVALID')
  return v.map(parse)
}
function page<T>(v: unknown, parse: (x: unknown) => T): Page<T> {
  const d = record(v)
  return { items: array(d.items, parse), next_cursor: text(d.next_cursor) }
}
export function parsePreferences(v: unknown): Preferences {
  const d = record(v),
    theme = text(d.theme),
    quality = text(d.image_quality)
  if (!['light', 'dark', 'system'].includes(theme) || !['low', 'medium', 'high'].includes(quality))
    throw new ApiError('RESPONSE_INVALID')
  return {
    theme: theme as Preferences['theme'],
    instructions: text(d.instructions),
    image_quality: quality as Preferences['image_quality'],
    image_ratio: text(d.image_ratio),
    image_count: integer(d.image_count),
  }
}
export function parseAnnouncement(v: unknown): Announcement {
  const d = record(v)
  return {
    id: text(d.id),
    content: text(d.content),
    starts_at: text(d.starts_at),
    ends_at: d.ends_at === null ? null : text(d.ends_at),
    enabled: boolean(d.enabled),
    version: integer(d.version),
    created_at: text(d.created_at),
  }
}
export function parseOperations(v: unknown): OperationsSettings {
  const d = record(v)
  return {
    maintenance: boolean(d.maintenance),
    turnstile_enabled: boolean(d.turnstile_enabled),
    turnstile_site_key: text(d.turnstile_site_key),
    turnstile_hostname: text(d.turnstile_hostname),
    turnstile_secret_configured: boolean(d.turnstile_secret_configured),
    register_per_ip_day: integer(d.register_per_ip_day),
    circuit_failures: integer(d.circuit_failures),
    circuit_seconds: integer(d.circuit_seconds),
    sensitive_words: array(d.sensitive_words ?? [], text),
  }
}
function parseDashboard(v: unknown): Dashboard {
  const d = record(v)
  return {
    users: integer(d.users),
    active_streams: integer(d.active_streams),
    credit_changes: integer(d.credit_changes),
    days: array(d.days, (v) => {
      const r = record(v)
      return {
        date: text(r.date),
        signup_credits: integer(r.signup_credits),
        daily_credits: integer(r.daily_credits),
        redeem_credits: integer(r.redeem_credits),
        admin_credits: integer(r.admin_credits),
        new_users: integer(r.new_users),
        active_users: integer(r.active_users),
        chat_messages: integer(r.chat_messages),
        image_success: integer(r.image_success),
        image_failed: integer(r.image_failed),
        credits_granted: integer(r.credits_granted),
        credits_spent: integer(r.credits_spent),
      }
    }),
    upstreams: array(d.upstreams, (v) => {
      const r = record(v)
      return {
        id: text(r.UpstreamID),
        calls: integer(r.Calls),
        successes: integer(r.Successes),
        latency_ms: integer(r.LatencyMs),
      }
    }),
  }
}
function parseSystem(v: unknown): SystemInfo {
  const d = record(v)
  return {
    version: text(d.version),
    commit: text(d.commit),
    build_time: text(d.build_time),
    uptime_seconds: integer(d.uptime_seconds),
    database_ok: boolean(d.database_ok),
    redis_ok: boolean(d.redis_ok),
    image_bytes: integer(d.image_bytes),
  }
}
export async function downloadResponse(response: Response, filename: string) {
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const operations = {
  preferences: () => authorized('/api/v1/me/preferences', parsePreferences),
  savePreferences: (body: Preferences) =>
    authorized('/api/v1/me/preferences', parsePreferences, { method: 'PUT', body }),
  devices: (cursor = '') =>
    authorized('/api/v1/me/sessions?limit=50&cursor=' + encodeURIComponent(cursor), (v) => {
      const d = record(v)
      return {
        current_id: text(d.current_id),
        next_cursor: text(d.next_cursor),
        items: array(d.items, (v) => {
          const r = record(v)
          return {
            id: text(r.id),
            device: text(r.device),
            ip: text(r.ip),
            user_agent: text(r.user_agent),
            created_at: text(r.created_at),
            expires_at: text(r.expires_at),
          }
        }),
      }
    }),
  revoke: (id: string) =>
    authorized('/api/v1/me/sessions/' + encodeURIComponent(id), noContent, { method: 'DELETE' }),
  revokeAll: (id: string) =>
    authorized('/api/v1/admin/users/' + encodeURIComponent(id) + '/sessions', noContent, {
      method: 'DELETE',
    }),
  deleteSelf: (email: string, password: string) =>
    authorized('/api/v1/me', noContent, { method: 'DELETE', body: { email, password } }),
  dashboard: (days: number) => authorized('/api/v1/admin/dashboard?days=' + days, parseDashboard),
  announcements: (admin = false, cursor = '') =>
    authorized(
      '/api/v1/' +
        (admin ? 'admin/' : '') +
        'announcements?limit=100&cursor=' +
        encodeURIComponent(cursor),
      (v) => page(v, parseAnnouncement),
    ),
  saveAnnouncement: (
    body: Pick<Announcement, 'content' | 'starts_at' | 'ends_at' | 'enabled' | 'version'>,
    id?: string,
  ) =>
    authorized(
      '/api/v1/admin/announcements' + (id ? '/' + encodeURIComponent(id) : ''),
      parseAnnouncement,
      { method: id ? 'PUT' : 'POST', body },
    ),
  deleteAnnouncement: (id: string) =>
    authorized('/api/v1/admin/announcements/' + encodeURIComponent(id), noContent, {
      method: 'DELETE',
    }),
  settings: () => authorized('/api/v1/admin/operations-settings', parseOperations),
  saveSettings: (value: OperationsSettings, secret?: string) => {
    const { turnstile_secret_configured: configured, ...body } = value
    void configured
    return authorized('/api/v1/admin/operations-settings', parseOperations, {
      method: 'PUT',
      body: { ...body, ...(secret !== undefined ? { turnstile_secret: secret } : {}) },
    })
  },
  system: () => authorized('/api/v1/admin/system', parseSystem),
  cleanup: () => authorized('/api/v1/admin/system/cleanup', noContent, { method: 'POST' }),
  testMail: () => authorized('/api/v1/admin/mail/test', noContent, { method: 'POST' }),
  refund: (id: string, note: string) =>
    authorized('/api/v1/admin/image-tasks/' + encodeURIComponent(id) + '/refund', noContent, {
      method: 'POST',
      body: { note },
    }),
  batchUsers: (ids: string[], action: string, amount: number, note: string, key: string) =>
    authorized('/api/v1/admin/users/batch', noContent, {
      method: 'POST',
      idempotencyKey: key,
      body: { ids, action, amount, note, confirm: action === 'delete' },
    }),
  exportUsers: async (query: URLSearchParams) =>
    downloadResponse(
      await authorizedResponse('/api/v1/admin/users/export?' + query),
      'lumi-users.csv',
    ),
  exportChats: async (format: 'json' | 'markdown', id?: string) =>
    downloadResponse(
      await authorizedResponse(
        (id
          ? '/api/v1/conversations/' + encodeURIComponent(id) + '/export'
          : '/api/v1/me/chat-export') +
          '?format=' +
          format,
      ),
      'lumi-chats.' + (format === 'json' ? 'json' : 'md'),
    ),
  downloadImages: async (ids: string[]) =>
    downloadResponse(
      await authorizedResponse('/api/v1/me/images/batch-download', {
        method: 'POST',
        body: { ids },
      }),
      'lumi-images.zip',
    ),
  deleteImages: (ids: string[]) =>
    authorized('/api/v1/me/images/batch-delete', noContent, { method: 'POST', body: { ids } }),
  chats: (query: URLSearchParams) =>
    authorized('/api/v1/admin/conversations?' + query, (v) =>
      page(v, (v) => {
        const d = record(v)
        return {
          id: text(d.id),
          user_id: text(d.user_id),
          model_id: d.model_id === null ? null : text(d.model_id),
          created_at: text(d.created_at),
          last_message_at: text(d.last_message_at),
          busy: boolean(d.busy),
        }
      }),
    ),
  forgot: (email: string, locale: string) =>
    request('/api/v1/auth/forgot-password', noContent, { method: 'POST', body: { email, locale } }),
  reset: (token: string, password: string) =>
    request('/api/v1/auth/reset-password', noContent, {
      method: 'POST',
      body: { token, password },
    }),
}
