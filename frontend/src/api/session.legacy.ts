import { useAuthStore } from '../stores/auth'
import type { SessionAdapter } from './session'

// Only the legacy build resolves the session port to Pinia.
export function getSession(): SessionAdapter {
  const auth = useAuthStore()
  return { snapshot: auth.sessionSnapshot, refresh: auth.refresh }
}
