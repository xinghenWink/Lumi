import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { getVersion } from '../api/client'

let client: QueryClient
const options = {
  queryKey: ['public', 'version'],
  queryFn: ({ signal }: { signal: AbortSignal }) => getVersion(signal),
  retry: false,
}
beforeEach(() => {
  client = new QueryClient()
})
afterEach(() => client.clear())

describe('system version', () => {
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
    await client.fetchQuery(options)
    expect(client.getQueryState(options.queryKey)?.status).toBe('success')
    expect(
      client.getQueryData<Awaited<ReturnType<typeof getVersion>>>(options.queryKey)?.version,
    ).toBe('v0.0.1')
  })
  it('allows retry after a backend error and rejects malformed JSON', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 123 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 'dev', commit: 'unknown', build_time: 'unknown' })),
      )
    vi.stubGlobal('fetch', fetcher)
    await expect(client.fetchQuery(options)).rejects.toThrow('VERSION_UNAVAILABLE')
    expect(client.getQueryState(options.queryKey)?.status).toBe('error')
    expect(client.getQueryData(options.queryKey)).toBeUndefined()
    await expect(client.fetchQuery(options)).rejects.toThrow('VERSION_INVALID')
    expect(client.getQueryState(options.queryKey)?.status).toBe('error')
    await client.fetchQuery(options)
    expect(client.getQueryState(options.queryKey)?.status).toBe('success')
  })
  it('coalesces overlapping requests', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const firstRequest = client.fetchQuery(options),
      secondRequest = client.fetchQuery(options)
    expect(fetcher).toHaveBeenCalledTimes(1)
    if (!resolveResponse) throw new Error('Request did not start')
    resolveResponse(
      new Response(JSON.stringify({ version: 'dev', commit: 'unknown', build_time: 'unknown' })),
    )
    await Promise.all([firstRequest, secondRequest])
    expect(client.getQueryState(options.queryKey)?.status).toBe('success')
  })
})
