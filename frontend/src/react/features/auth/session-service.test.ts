import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionService } from '../../../api/auth-session'
import { createAuthorizedClient } from '../../../api/session'
import { record } from '../../../api/transport'

const user = {
  id: '019a0000-0000-7000-8000-000000000001',
  email: 'session@lumi.test',
  nickname: 'Member',
  role: 'user',
  status: 'active',
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  created_at: '2026-10-22T00:00:00Z',
  last_login_at: null,
  last_login_ip: '',
}
const authenticated = (id = user.id) =>
  new Response(
    JSON.stringify({
      access_token: 'memory-only',
      token_type: 'Bearer',
      expires_in: 900,
      user: { ...user, id },
    }),
  )
beforeEach(() => localStorage.clear())

describe('React session service', () => {
  it('serializes overlapping login cookies and discards the obsolete identity', async () => {
    let start: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    let complete: ((value: Response) => void) | undefined
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => {
        start?.()
        return new Promise<Response>((resolve) => {
          complete = resolve
        })
      })
      .mockImplementationOnce(() =>
        Promise.resolve(authenticated('019a0000-0000-7000-8000-000000000002')),
      )
    vi.stubGlobal('fetch', fetch)
    const service = createSessionService()
    const first = service.login({ email: user.email, password: 'TestOnlyPassword42' })
    await started
    const rejected = expect(first).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    const second = service.login({ email: 'other@lumi.test', password: 'TestOnlyPassword42' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot().user).toBeNull()
    if (!complete) throw new Error('Login did not start')
    complete(authenticated())
    await rejected
    await second
    expect(service.getSnapshot().user?.id).toBe('019a0000-0000-7000-8000-000000000002')
  })

  it('waits for an in-flight login instead of starting another cookie refresh', async () => {
    let start: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    let complete: ((value: Response) => void) | undefined
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => {
        start?.()
        return new Promise<Response>((resolve) => {
          complete = resolve
        })
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ private: 'owned' })))
    vi.stubGlobal('fetch', fetch)
    const service = createSessionService()
    const login = service.login({ email: user.email, password: 'TestOnlyPassword42' })
    await started
    const request = createAuthorizedClient(() => service).authorized('/private', record)
    if (!complete) throw new Error('Login did not start')
    complete(authenticated())
    await login
    await expect(request).resolves.toEqual({ private: 'owned' })
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/v1/auth/login', '/private'])
  })

  it('coalesces startup and refresh through the browser lock without persisting credentials', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(authenticated()))
    vi.stubGlobal('fetch', fetch)
    const lock = vi.fn(async (perform: () => Promise<void>) => perform())
    const service = createSessionService(lock)
    await Promise.all([service.bootstrap(), service.bootstrap(), service.refresh()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot()).toMatchObject({ initialized: true, token: 'memory-only' })
    expect(localStorage.length).toBe(0)
    const init = fetch.mock.calls[0]?.[1] as RequestInit
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).get('X-Lumi-CSRF')).toBe('1')
  })

  it('does not clear a new login when an older refresh is rejected', async () => {
    let complete: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              complete = resolve
            }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(authenticated('019a0000-0000-7000-8000-000000000002')),
        ),
    )
    const service = createSessionService()
    const pending = service.refresh()
    const login = service.login({ email: 'other@lumi.test', password: 'TestOnlyPassword42' })
    if (!complete) throw new Error('Refresh did not start')
    complete(new Response(JSON.stringify({ code: 'AUTH_REQUIRED' }), { status: 401 }))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    await login
    expect(service.getSnapshot().user?.id).toBe('019a0000-0000-7000-8000-000000000002')
  })

  it('discards old successful refresh results after clear', async () => {
    let complete: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      ),
    )
    const service = createSessionService()
    const pending = service.refresh()
    service.clear()
    if (!complete) throw new Error('Refresh did not start')
    complete(authenticated())
    await pending
    expect(service.getSnapshot()).toMatchObject({ user: null, token: null })
  })

  it('retains authentication on transient failures and waits for logout acknowledgement', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(authenticated()))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const service = createSessionService()
    await service.login({ email: user.email, password: 'TestOnlyPassword42' })
    await expect(service.refresh()).rejects.toMatchObject({ status: 503 })
    expect(service.getSnapshot().user?.id).toBe(user.id)
    await service.logout()
    expect(service.getSnapshot()).toMatchObject({ user: null, token: null })
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('finishes an outstanding refresh before revoking its rotated cookie', async () => {
    let complete: ((value: Response) => void) | undefined
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const service = createSessionService()
    const refresh = service.refresh()
    const logout = service.logout()
    expect(fetch).toHaveBeenCalledTimes(1)
    if (!complete) throw new Error('Refresh did not start')
    complete(authenticated())
    await Promise.all([refresh, logout])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(service.getSnapshot()).toMatchObject({ user: null, token: null })
  })
})
