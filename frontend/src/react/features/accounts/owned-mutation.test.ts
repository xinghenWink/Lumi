import { describe, expect, it, vi } from 'vitest'
import { createSessionService } from '../../../api/auth-session'
import { assertOwnership } from './owned-mutation'

describe('private action ownership', () => {
  it('rejects an old action after clearing and signing into the same identity again', async () => {
    const user = {
      id: 'owner',
      email: 'owner@lumi.test',
      nickname: 'Owner',
      role: 'user',
      status: 'active',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      created_at: 'now',
      last_login_at: null,
      last_login_ip: '',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              user,
              access_token: 'memory-token',
              token_type: 'Bearer',
              expires_in: 900,
            }),
          ),
      ),
    )
    const session = createSessionService()
    await session.login({ email: user.email, password: 'OnlyTestPassword42' })
    const stamp = { owner: user.id, epoch: session.snapshot().epoch }
    expect(() => assertOwnership(session, stamp)).not.toThrow()
    session.clear()
    expect(() => assertOwnership(session, stamp)).toThrow('AUTH_REQUIRED')
    await session.login({ email: user.email, password: 'OnlyTestPassword42' })
    expect(() => assertOwnership(session, stamp)).toThrow('AUTH_REQUIRED')
  })
})
