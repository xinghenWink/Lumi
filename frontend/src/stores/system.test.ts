import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSystemStore } from './system'

describe('system version', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads build metadata from the backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            version: 'v0.0.1',
            commit: 'abc123',
            build_time: '2026-10-22T00:00:00Z',
          }),
        ),
      ),
    )
    const store = useSystemStore()
    await store.loadVersion()
    expect(store.status).toBe('ready')
    expect(store.version?.version).toBe('v0.0.1')
  })

  it('allows retry after a backend error and rejects malformed JSON', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 123 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 'dev', commit: 'unknown', build_time: 'unknown' })),
      )
    vi.stubGlobal('fetch', fetch)
    const store = useSystemStore()
    await store.loadVersion()
    expect(store.status).toBe('error')
    expect(store.version).toBeNull()
    await store.loadVersion()
    expect(store.status).toBe('error')
    await store.loadVersion()
    expect(store.status).toBe('ready')
  })

  it('coalesces overlapping requests', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const store = useSystemStore()
    const firstRequest = store.loadVersion()
    await store.loadVersion()
    expect(fetch).toHaveBeenCalledTimes(1)
    if (!resolveResponse) throw new Error('Request did not start')
    resolveResponse(
      new Response(JSON.stringify({ version: 'dev', commit: 'unknown', build_time: 'unknown' })),
    )
    await firstRequest
  })
})
