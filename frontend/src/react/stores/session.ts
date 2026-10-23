import { createStore } from 'zustand/vanilla'
import type { SessionService, SessionState } from '../../api/auth-session'

export function createSessionStore(session: SessionService) {
  const store = createStore<SessionState>()(() => session.getSnapshot())
  const dispose = session.subscribe(() => store.setState(session.getSnapshot(), true))
  return { store, dispose }
}
