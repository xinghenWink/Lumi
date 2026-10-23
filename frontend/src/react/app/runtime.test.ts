import { describe, expect, it, vi } from 'vitest'
import { createAppRuntime } from './runtime'
import { createSessionService } from '../../api/auth-session'

describe('application runtime isolation', () => {
  it('also clears cached work created during the anonymous login transition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'memory-only',
            token_type: 'Bearer',
            expires_in: 900,
            user: {
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
            },
          }),
        ),
      ),
    )
    const service = createSessionService()
    const runtime = createAppRuntime(service)
    const login = service.login({ email: 'member@lumi.test', password: 'TestOnlyPassword42' })
    runtime.queryClient.setQueryData(['private', 'transition'], ['obsolete'])
    await login
    expect(runtime.queryClient.getQueryData(['private', 'transition'])).toBeUndefined()
    runtime.dispose()
  })

  it('removes private cached data when an identity generation changes', () => {
    const service = createSessionService()
    const runtime = createAppRuntime(service)
    runtime.queryClient.setQueryData(['private', 'owner-a', 'conversations'], ['private-content'])
    service.clear()
    expect(
      runtime.queryClient.getQueryData(['private', 'owner-a', 'conversations']),
    ).toBeUndefined()
    expect(runtime.sessionStore.getState().user).toBeNull()
    runtime.dispose()
  })

  it('keeps appearance persistence usable while storage is blocked', () => {
    const runtime = createAppRuntime(createSessionService())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    runtime.themeStore.getState().setTheme('dark')
    expect(runtime.themeStore.getState().preference).toBe('dark')
    runtime.dispose()
  })
})
