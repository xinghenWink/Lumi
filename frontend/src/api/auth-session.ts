import { ApiError, noContent, request } from './transport'
import {
  parseAuth,
  parseCodeSent,
  type AuthResult,
  type LoginInput,
  type RegisterInput,
  type User,
} from './contracts'
import type { SessionAdapter, SessionSnapshot } from './session'

export interface SessionState extends SessionSnapshot {
  user: User | null
  initialized: boolean
}

type RefreshLock = (perform: () => Promise<void>) => Promise<void>
const browserLock: RefreshLock = async (perform) => {
  if (navigator.locks) await navigator.locks.request('lumi:refresh', perform)
  else await perform()
}

export function createSessionService(withRefreshLock: RefreshLock = browserLock) {
  let state: SessionState = {
    user: null,
    token: null,
    initialized: false,
    epoch: 0,
    revision: 0,
  }
  const listeners = new Set<() => void>()
  let pendingRefresh: Promise<void> | null = null
  let pendingInit: Promise<void> | null = null
  let pendingAuthentication: Promise<void> | null = null
  let loggingOut = false

  function patch(next: Partial<SessionState>) {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }
  function apply(result: AuthResult) {
    patch({ user: result.user, token: result.access_token, revision: state.revision + 1 })
  }
  function clear() {
    patch({ user: null, token: null, epoch: state.epoch + 1, revision: state.revision + 1 })
  }
  function refresh(): Promise<void> {
    if (loggingOut) return Promise.reject(new ApiError('AUTH_REQUIRED', 401))
    if (pendingAuthentication) return pendingAuthentication
    if (pendingRefresh) return pendingRefresh
    const epoch = state.epoch
    pendingRefresh = withRefreshLock(async () => {
      if (state.epoch !== epoch) throw new ApiError('AUTH_REQUIRED', 401)
      try {
        const result = await request('/api/v1/auth/refresh', parseAuth, { method: 'POST' })
        if (state.epoch === epoch) apply(result)
      } catch (error) {
        if (
          state.epoch === epoch &&
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        )
          clear()
        throw error
      }
    }).finally(() => {
      pendingRefresh = null
    })
    return pendingRefresh
  }
  function bootstrap(): Promise<void> {
    if (state.initialized) return Promise.resolve()
    if (pendingInit) return pendingInit
    pendingInit = refresh()
      .catch(() => {
        /* Authentication failures and offline startup remain visible to the route boundary. */
      })
      .finally(() => {
        patch({ initialized: true })
        pendingInit = null
      })
    return pendingInit
  }
  function authenticate(path: string, body: LoginInput | RegisterInput): Promise<void> {
    if (loggingOut) return Promise.reject(new ApiError('AUTH_REQUIRED', 401))
    const epoch = state.epoch + 1
    const previous = pendingAuthentication
    const rotation = pendingRefresh
    // Cookie writes complete in order even when an earlier response becomes obsolete.
    const operation = Promise.resolve().then(async () => {
      await previous?.catch(() => undefined)
      await rotation?.catch(() => undefined)
      if (state.epoch !== epoch) throw new ApiError('AUTH_REQUIRED', 401)
      const result = await request(path, parseAuth, { method: 'POST', body })
      if (state.epoch !== epoch) throw new ApiError('AUTH_REQUIRED', 401)
      apply(result)
      patch({ initialized: true })
    })
    pendingAuthentication = operation
    patch({ epoch, user: null, token: null, revision: state.revision + 1 })
    return operation.finally(() => {
      if (pendingAuthentication === operation) pendingAuthentication = null
    })
  }
  async function logout() {
    loggingOut = true
    try {
      await pendingAuthentication?.catch(() => undefined)
      await pendingRefresh?.catch(() => undefined)
      await request('/api/v1/auth/logout', noContent, { method: 'POST' })
      clear()
    } finally {
      loggingOut = false
    }
  }
  function updateUser(user: User) {
    if (user.id !== state.user?.id) throw new ApiError('AUTH_REQUIRED', 401)
    patch({ user })
  }
  const adapter: SessionAdapter = { snapshot: () => state, refresh }
  return {
    ...adapter,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    bootstrap,
    clear,
    login: (body: LoginInput) => authenticate('/api/v1/auth/login', body),
    register: (body: RegisterInput) => authenticate('/api/v1/auth/register', body),
    logout,
    updateUser,
    sendCode: (email: string, locale: 'zh-CN' | 'en', turnstile_token?: string) =>
      request('/api/v1/auth/send-code', parseCodeSent, {
        method: 'POST',
        body: { email, locale, ...(turnstile_token ? { turnstile_token } : {}) },
      }),
  }
}

export type SessionService = ReturnType<typeof createSessionService>
