import { describe, it, expect } from 'vitest'
import { consumeImageEvents, parseTask, parseFile } from '../../api/images'
import { task } from './test-fixtures'
function response(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
describe('image contracts and subscription recovery boundary', () => {
  it('reads split UTF-8/CRLF task events and requires a final event', async () => {
    const items: string[] = []
    await consumeImageEvents(
      response(
        'event: task\r\ndata: ' +
          JSON.stringify({ task }) +
          '\r\n\r\nevent: ping\ndata: {}\n\nevent: done\ndata: ' +
          JSON.stringify({ task }) +
          '\n\n',
      ),
      (row) => items.push(row.prompt),
    )
    expect(items).toEqual(['星空', '星空'])
    await expect(
      consumeImageEvents(
        response('event: task\ndata: ' + JSON.stringify({ task }) + '\n\n'),
        () => undefined,
      ),
    ).rejects.toThrow('NETWORK_ERROR')
  })
  it('strips private provider data and rejects unsafe counters and file locations', () => {
    expect(
      JSON.stringify(parseTask({ ...task, api_key: 'private', params: { secret: 'private' } })),
    ).not.toContain('private')
    expect(() => parseTask({ ...task, total_cost: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      'RESPONSE_INVALID',
    )
    expect(() =>
      parseFile({
        id: 'file',
        kind: 'generated',
        mime: 'image/png',
        size: 1,
        width: 1,
        height: 1,
        thumbnail_width: 1,
        thumbnail_height: 1,
        url: 'https://foreign.example/image.png',
        thumbnail_url: '/api/v1/files/abc/thumb?expires=1',
        expires_at: 1,
        created_at: 'now',
      }),
    ).toThrow('RESPONSE_INVALID')
  })
})
