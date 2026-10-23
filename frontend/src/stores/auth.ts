import { defineStore } from 'pinia'
import { onScopeDispose, ref, shallowRef } from 'vue'
import { createSessionService } from '../api/auth-session'

// The temporary Vue facade projects the same framework-independent session as React.
export const useAuthStore = defineStore('auth', () => {
  const service = createSessionService()
  const user = shallowRef(service.getSnapshot().user)
  const accessToken = ref(service.getSnapshot().token)
  const initialized = ref(service.getSnapshot().initialized)
  onScopeDispose(
    service.subscribe(() => {
      const snapshot = service.getSnapshot()
      user.value = snapshot.user
      accessToken.value = snapshot.token
      initialized.value = snapshot.initialized
    }),
  )
  return {
    user,
    accessToken,
    initialized,
    bootstrap: service.bootstrap,
    refresh: service.refresh,
    login: service.login,
    register: service.register,
    logout: service.logout,
    sendCode: service.sendCode,
    clear: service.clear,
    updateUser: service.updateUser,
    sessionSnapshot: service.snapshot,
  }
})
