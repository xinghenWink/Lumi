import { describe, it, expect } from 'vitest'
import { consumeChat, parseMessage, parseConfiguration, type ChatEvent } from '../../api/chat'
const conversation = {
  id: 'conversation',
  title: 'Hello',
  model_id: 'model',
  pinned: false,
  busy: false,
  version: 1,
  last_message_at: '2026-10-22T00:00:00Z',
  created_at: '2026-10-22T00:00:00Z',
}
function response(text: string, step = 1) {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let at = 0; at < bytes.length; at += step)
          controller.enqueue(bytes.slice(at, at + step))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
describe('chat streaming contracts', () => {
  it('records resume IDs only after valid frames are delivered', async () => {
    const ids: string[] = [],
      events: ChatEvent[] = []
    await consumeChat(
      response(
        'id: 100-1\nevent: delta\ndata: {"content":"first"}\n\nid: invalid\nevent: delta\ndata: {"content":"second"}\n\nid: 100-2\nevent: done\ndata: {}\n\n',
      ),
      (e) => events.push(e),
      (id) => ids.push(id),
    )
    expect(ids).toEqual(['100-1', '100-2'])
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'done'])
  })
  it('parses split UTF-8 and CRLF without relying on transport chunk boundaries', async () => {
    const events: ChatEvent[] = []
    await consumeChat(
      response(
        'event: delta\r\ndata: {"content":"你好"}\r\n\r\nevent: done\r\ndata: ' +
          JSON.stringify({ conversation }) +
          '\r\n\r\n',
      ),
      (e) => events.push(e),
    )
    expect(events[0]).toEqual({ type: 'delta', content: '你好' })
    expect(events.at(-1)?.type).toBe('done')
  })
  it('requires an explicit terminal frame and rejects malformed data', async () => {
    await expect(
      consumeChat(response('event: delta\ndata: {"content":"partial"}\n\n'), () => undefined),
    ).rejects.toThrow('CHAT_INTERRUPTED')
    await expect(
      consumeChat(response('event: delta\ndata: {"content":4}\n\n'), () => undefined),
    ).rejects.toThrow('RESPONSE_INVALID')
    await expect(
      consumeChat(response('event: unknown\ndata: {}\n\n'), () => undefined),
    ).rejects.toThrow('RESPONSE_INVALID')
  })
  it('allows only public message metadata and rejects invalid counters', () => {
    const message = parseMessage({
      id: 'a',
      request_id: 'r',
      role: 'assistant',
      content: 'safe',
      status: 'completed',
      model_id: null,
      created_at: 'now',
      upstream_id: 'private',
      request_hash: 'private-hash',
      meta: {
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        wire_model: 'secret',
      },
    })
    expect(JSON.stringify(message)).not.toMatch(/private|secret|wire_model/)
    expect(() => parseConfiguration({ per_minute: -1 })).toThrow('RESPONSE_INVALID')
  })
})
