import { describe, expect, it, vi } from 'vitest'
import { createAuthorizedClient, type SessionSnapshot } from './session'
import { ApiError, record } from './transport'

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

describe('framework-independent authorized client', () => {
  it('retries once with the original business payload and headers', async () => {
    let snapshot: SessionSnapshot = { token: 'expired', epoch: 1, revision: 1 }
    const refresh = vi.fn(async () => {
      snapshot = { ...snapshot, token: 'renewed', revision: 2 }
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: 'AUTH_REQUIRED' }))
      .mockResolvedValueOnce(json(200, { accepted: true }))
    vi.stubGlobal('fetch', fetch)
    const client = createAuthorizedClient(() => ({ snapshot: () => snapshot, refresh }))
    await client.authorized('/api/v1/image-tasks', record, {
      method: 'POST',
      body: { prompt: 'same payload' },
      idempotencyKey: 'same-operation',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    const requests = fetch.mock.calls.map((call) => call[1] as RequestInit)
    expect(requests[0]?.body).toBe(requests[1]?.body)
    expect(requests.map((init) => new Headers(init.headers).get('Idempotency-Key'))).toEqual([
      'same-operation',
      'same-operation',
    ])
    expect(new Headers(requests[1]?.headers).get('Authorization')).toBe('Bearer renewed')
  })

  it('does not refresh a different account after a delayed 401', async () => {
    let snapshot: SessionSnapshot = { token: 'owner-a', epoch: 1, revision: 1 }
    let complete: ((response: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      ),
    )
    const refresh = vi.fn(async () => undefined)
    const client = createAuthorizedClient(() => ({ snapshot: () => snapshot, refresh }))
    const result = client.authorized('/private', record)
    snapshot = { token: 'owner-b', epoch: 2, revision: 2 }
    if (!complete) throw new Error('Request did not start')
    complete(json(401, { code: 'AUTH_REQUIRED' }))
    await expect(result).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('uses a completed concurrent refresh without rotating the cookie again', async () => {
    let snapshot: SessionSnapshot = { token: 'same-jwt', epoch: 1, revision: 1 }
    let complete: ((response: Response) => void) | undefined
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      )
      .mockResolvedValueOnce(json(200, { ok: true }))
    vi.stubGlobal('fetch', fetch)
    const refresh = vi.fn(async () => undefined)
    const client = createAuthorizedClient(() => ({ snapshot: () => snapshot, refresh }))
    const result = client.authorized('/private', record)
    snapshot = { ...snapshot, revision: 2 }
    if (!complete) throw new Error('Request did not start')
    complete(json(401, { code: 'AUTH_REQUIRED' }))
    await expect(result).resolves.toEqual({ ok: true })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not repeat transient failures or a second unauthorized response', async () => {
    const refresh = vi.fn(async () => undefined)
    const client = createAuthorizedClient(() => ({
      snapshot: () => ({ token: 'token', epoch: 1, revision: 1 }),
      refresh,
    }))
    const fetch = vi.fn().mockResolvedValue(json(503, { code: 'UNAVAILABLE' }))
    vi.stubGlobal('fetch', fetch)
    await expect(client.authorized('/private', record)).rejects.toBeInstanceOf(ApiError)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    fetch
      .mockReset()
      .mockImplementation(() => Promise.resolve(json(401, { code: 'AUTH_REQUIRED' })))
    await expect(client.authorized('/private', record)).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('honors cancellation before sending or retrying a business request', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = createAuthorizedClient(() => ({
      snapshot: () => ({ token: 'token', epoch: 1, revision: 1 }),
      refresh: async () => undefined,
    }))
    await expect(
      client.authorized('/private', record, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
