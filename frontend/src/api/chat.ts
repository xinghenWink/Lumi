import type { components } from './schema'
import { authorized, authorizedResponse } from './protected'
import { ApiError, record, noContent } from './transport'
type S = components['schemas']
export type Conversation = S['ChatConversation']
export type Message = S['ChatMessage']
export type ChatConfiguration = S['ChatConfiguration']
export type SendInput = S['ChatSendInput']
export interface ChatPage<T> {
  items: T[]
  next_cursor: string
}
export type ChatEvent =
  | { type: 'meta' | 'done'; conversation?: Conversation; user?: Message; assistant?: Message }
  | { type: 'delta'; content: string }
  | { type: 'error'; code: string; assistant?: Message }
  | { type: 'ping' }
function str(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('RESPONSE_INVALID')
  return value
}
function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ApiError('RESPONSE_INVALID')
  return value
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ApiError('RESPONSE_INVALID')
  return value
}
function nullable(value: unknown): string | null {
  return value === null ? null : str(value)
}
export function parseConversation(value: unknown): Conversation {
  const d = record(value)
  return {
    id: str(d.id),
    title: str(d.title),
    model_id: nullable(d.model_id),
    pinned: bool(d.pinned),
    busy: bool(d.busy),
    version: int(d.version),
    created_at: str(d.created_at),
    last_message_at: str(d.last_message_at),
  }
}
export function parseMessage(value: unknown): Message {
  const d = record(value),
    meta = record(d.meta)
  const role = str(d.role),
    status = str(d.status)
  if (
    (role !== 'user' && role !== 'assistant') ||
    !['streaming', 'completed', 'interrupted', 'error'].includes(status)
  )
    throw new ApiError('RESPONSE_INVALID')
  const result: Message = {
    id: str(d.id),
    request_id: str(d.request_id),
    role,
    content: str(d.content),
    status: status as Message['status'],
    model_id: nullable(d.model_id),
    meta: {},
    created_at: str(d.created_at),
  }
  if (meta.error_code !== undefined) result.meta.error_code = str(meta.error_code)
  if (meta.finish_reason !== undefined) result.meta.finish_reason = str(meta.finish_reason)
  if (meta.latency_ms !== undefined) result.meta.latency_ms = int(meta.latency_ms)
  if (meta.usage !== undefined) {
    const u = record(meta.usage)
    result.meta.usage = {
      prompt_tokens: int(u.prompt_tokens),
      completion_tokens: int(u.completion_tokens),
      total_tokens: int(u.total_tokens),
    }
  }
  return result
}
function parsePage<T>(value: unknown, parse: (v: unknown) => T): ChatPage<T> {
  const d = record(value)
  if (!Array.isArray(d.items)) throw new ApiError('RESPONSE_INVALID')
  return { items: d.items.map(parse), next_cursor: str(d.next_cursor) }
}
export function parseConfiguration(value: unknown): ChatConfiguration {
  const d = record(value)
  return {
    per_minute: int(d.per_minute),
    per_day: int(d.per_day),
    context_messages: int(d.context_messages),
    context_tokens: int(d.context_tokens),
    system_prompt: str(d.system_prompt),
    title_model_id: nullable(d.title_model_id),
    version: int(d.version),
  }
}
export function parseEvent(type: string, value: unknown): ChatEvent {
  const d = record(value)
  if (type === 'delta') return { type, content: str(d.content) }
  if (type === 'ping') return { type }
  if (type === 'error')
    return {
      type,
      code: str(d.code),
      ...(d.assistant ? { assistant: parseMessage(d.assistant) } : {}),
    }
  if (type !== 'meta' && type !== 'done') throw new ApiError('RESPONSE_INVALID')
  return {
    type,
    ...(d.conversation ? { conversation: parseConversation(d.conversation) } : {}),
    ...(d.user ? { user: parseMessage(d.user) } : {}),
    ...(d.assistant ? { assistant: parseMessage(d.assistant) } : {}),
  }
}
// Parse UTF-8 and SSE frame boundaries independently of the transport's chunk boundaries.
export async function consumeChat(
  response: Response,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
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
        let type = 'message'
        const data: string[] = []
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) type = line.slice(6).trim()
          if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        }
        if (data.length) {
          const value: unknown = JSON.parse(data.join('\n'))
          const event = parseEvent(type, value)
          onEvent(event)
          if (event.type === 'done') {
            done = true
            return
          }
        }
        match = buffer.match(/\r?\n\r?\n/)
      }
      if (chunk.done) break
    }
    if (!done) throw new ApiError('CHAT_INTERRUPTED')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
const path = (id: string) => `/api/v1/conversations/${encodeURIComponent(id)}`
export const chats = {
  list: (query: URLSearchParams, signal?: AbortSignal) =>
    authorized(
      `/api/v1/conversations?${query}`,
      (v) => parsePage(v, parseConversation),
      signal ? { signal } : {},
    ),
  create: (id: string, model_id: string) =>
    authorized('/api/v1/conversations', parseConversation, {
      method: 'POST',
      body: { id, model_id },
    }),
  get: (id: string, signal?: AbortSignal) =>
    authorized(path(id), parseConversation, signal ? { signal } : {}),
  messages: (id: string, cursor = '', signal?: AbortSignal) =>
    authorized(
      `${path(id)}/messages?limit=100&cursor=${encodeURIComponent(cursor)}`,
      (v) => parsePage(v, parseMessage),
      signal ? { signal } : {},
    ),
  update: (row: Conversation, title: string, pinned = row.pinned) =>
    authorized(path(row.id), parseConversation, {
      method: 'PATCH',
      body: { title, pinned, version: row.version },
    }),
  delete: (ids: string[], all = false) =>
    authorized('/api/v1/conversations/delete', noContent, { method: 'POST', body: { ids, all } }),
  stop: (id: string) => authorized(`${path(id)}/stop`, noContent, { method: 'POST' }),
  send: async (
    id: string,
    input: SendInput,
    signal: AbortSignal,
    onEvent: (e: ChatEvent) => void,
  ) => {
    const response = await authorizedResponse(`${path(id)}/messages`, {
      method: 'POST',
      body: input,
      signal,
    })
    await consumeChat(response, onEvent)
  },
  settings: (signal?: AbortSignal) =>
    authorized('/api/v1/admin/chat-settings', parseConfiguration, signal ? { signal } : {}),
  saveSettings: (body: ChatConfiguration) =>
    authorized('/api/v1/admin/chat-settings', parseConfiguration, { method: 'PUT', body }),
}
