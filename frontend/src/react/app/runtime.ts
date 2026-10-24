import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/transport'
import { session } from '../features/auth/session-adapter'
import type { SessionService } from '../../api/auth-session'
import { createSessionStore } from '../stores/session'
import { createThemeStore } from '../stores/theme'
import { createChatController } from '../features/chat/controller'
import { createModelSelectionStore } from '../features/catalog/models'

export function createAppRuntime(service: SessionService = session) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) =>
          failures < 1 && !(error instanceof ApiError && [401, 403, 404].includes(error.status)),
      },
      // Business writes retain explicit idempotency and recovery instead of automatic replay.
      mutations: { retry: false },
    },
  })
  const sessionState = createSessionStore(service)
  const chat = createChatController(service, queryClient)
  const modelStore = createModelSelectionStore()
  let epoch = service.getSnapshot().epoch
  let identity = service.getSnapshot().user?.id
  const unsubscribe = service.subscribe(() => {
    const next = service.getSnapshot()
    if (next.epoch !== epoch || next.user?.id !== identity) {
      epoch = next.epoch
      identity = next.user?.id
      modelStore.getState().reset()
      void queryClient.cancelQueries()
      queryClient.clear()
    }
  })
  return {
    session: service,
    sessionStore: sessionState.store,
    themeStore: createThemeStore(),
    modelStore,
    chat,
    queryClient,
    dispose() {
      unsubscribe()
      sessionState.dispose()
      chat.dispose()
      queryClient.clear()
    },
  }
}

export type AppRuntime = ReturnType<typeof createAppRuntime>
