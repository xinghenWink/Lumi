import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { request, noContent, ApiError } from '../api/transport'
import {
  parseAuth,
  parseCodeSent,
  type User,
  type AuthResult,
  type LoginInput,
  type RegisterInput,
} from '../api/contracts'

export const useAuthStore = defineStore('auth', () => {
  const user = shallowRef<User | null>(null)
  const accessToken = ref<string | null>(null)
  const initialized = ref(false)
  let pendingRefresh: Promise<void> | null = null
  let pendingInit: Promise<void> | null = null
  let generation = 0
  let loggingOut = false

  function apply(result: AuthResult) {
    user.value = result.user
    accessToken.value = result.access_token
  }
  function clear() {
    generation++
    user.value = null
    accessToken.value = null
  }
  async function refresh() {
    if (loggingOut) throw new ApiError('AUTH_REQUIRED', 401)
    if (pendingRefresh) return pendingRefresh
    const current = generation
    const perform = async () => {
      try {
        const result = await request('/api/v1/auth/refresh', parseAuth, { method: 'POST' })
        if (generation === current) apply(result)
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) clear()
        throw error
      }
    }
    const execute = async () => {
      if (navigator.locks) await navigator.locks.request('lumi:refresh', perform)
      else await perform()
    }
    pendingRefresh = execute().finally(() => {
      pendingRefresh = null
    })
    return pendingRefresh
  }
  async function bootstrap() {
    if (initialized.value) return
    if (pendingInit) return pendingInit
    pendingInit = (async () => {
      try {
        await refresh()
      } catch {
        /* Guests and offline sessions remain on the login page. */
      } finally {
        initialized.value = true
      }
    })()
    await pendingInit
  }
  async function login(input: LoginInput) {
    const result = await request('/api/v1/auth/login', parseAuth, { method: 'POST', body: input })
    generation++
    apply(result)
    initialized.value = true
  }
  async function register(input: RegisterInput) {
    const result = await request('/api/v1/auth/register', parseAuth, {
      method: 'POST',
      body: input,
    })
    generation++
    apply(result)
    initialized.value = true
  }
  async function logout() {
    loggingOut = true
    try {
      if (pendingRefresh) {
        try {
          await pendingRefresh
        } catch {
          /* Logout still revokes any remaining cookie. */
        }
      }
      await request('/api/v1/auth/logout', noContent, { method: 'POST' })
      clear()
    } finally {
      loggingOut = false
    }
  }
  async function sendCode(email: string, locale: 'zh-CN' | 'en', turnstile_token?: string) {
    return request('/api/v1/auth/send-code', parseCodeSent, {
      method: 'POST',
      body: { email, locale, ...(turnstile_token ? { turnstile_token } : {}) },
    })
  }
  function updateUser(value: User) {
    user.value = value
  }
  return {
    user,
    accessToken,
    initialized,
    bootstrap,
    refresh,
    login,
    register,
    logout,
    sendCode,
    clear,
    updateUser,
  }
})
