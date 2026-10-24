import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionService } from '../api/auth-session'
import { ApiError } from '../api/transport'

const user = {
  id: '019a0000-0000-7000-8000-000000000001',
  email: 'member@lumi.test',
  nickname: 'Member',
  role: 'user',
  status: 'active',
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  created_at: '2026-10-22T00:00:00Z',
  last_login_at: null,
  last_login_ip: '',
}
const authenticated = () =>
  new Response(
    JSON.stringify({
      access_token: 'test-token-in-memory',
      token_type: 'Bearer',
      expires_in: 900,
      user,
    }),
  )

describe('authentication state', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  it('coalesces refresh and keeps credentials out of storage', async () => {
    const fetch = vi.fn().mockResolvedValue(authenticated())
    vi.stubGlobal('fetch', fetch)
    const auth = createSessionService()
    await Promise.all([auth.refresh(), auth.refresh()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(auth.getSnapshot().user?.email).toBe(user.email)
    expect(auth.getSnapshot().token).toBe('test-token-in-memory')
    expect(localStorage.length).toBe(0)
    const init = fetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('X-Lumi-CSRF')).toBe('1')
    expect(init.credentials).toBe('same-origin')
  })
  it('clears expired sessions and does not restore an old in-flight result', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 'AUTH_REQUIRED' }), { status: 401 }),
        ),
    )
    const auth = createSessionService()
    await auth.bootstrap()
    expect(auth.getSnapshot().initialized).toBe(true)
    expect(auth.getSnapshot().user).toBeNull()
    let complete: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      ),
    )
    const pending = auth.refresh()
    auth.clear()
    if (!complete) throw new Error('Refresh did not begin')
    complete(authenticated())
    await pending
    expect(auth.getSnapshot().user).toBeNull()
    expect(auth.getSnapshot().token).toBeNull()
  })
  it('retains the session after a transient refresh failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(authenticated())
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const auth = createSessionService()
    await auth.login({ email: user.email, password: 'TestOnlyPassword42' })
    await expect(auth.refresh()).rejects.toBeInstanceOf(ApiError)
    expect(auth.getSnapshot().user?.email).toBe(user.email)
  })
  it('waits for server logout before discarding local access', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(authenticated())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const auth = createSessionService()
    await auth.login({ email: user.email, password: 'TestOnlyPassword42' })
    await auth.logout()
    expect(auth.getSnapshot().user).toBeNull()
    expect(auth.getSnapshot().token).toBeNull()
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
