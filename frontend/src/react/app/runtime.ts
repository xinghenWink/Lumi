import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'zustand/vanilla'
import { ApiError } from '../../api/transport'
import { session } from '../features/auth/session-adapter'
import type { SessionService } from '../../api/auth-session'
import { createSessionStore } from '../stores/session'
import { createThemeStore } from '../stores/theme'
import { createChatController } from '../features/chat/controller'
import { createModelSelectionStore } from '../features/catalog/models'
import type { ImageController } from '../features/images/controller'

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
  let image: Promise<ImageController> | undefined
  let imageController: ImageController | undefined
  let disposed = false
  let unsubscribeImage: (() => void) | undefined
  const imageNavigation = createStore(() => ({ lastOpened: '' }))
  const modelStore = createModelSelectionStore()
  let epoch = service.getSnapshot().epoch
  let identity = service.getSnapshot().user?.id
  let sessionExitTarget = ''
  const unsubscribe = service.subscribe(() => {
    const next = service.getSnapshot()
    if (next.user) sessionExitTarget = ''
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
    imageNavigation,
    chat,
    loadImage() {
      if (disposed) return Promise.reject(new Error('Application runtime was disposed'))
      image ??= import('../features/images/controller')
        .then(({ createImageController }) => {
          if (disposed) throw new Error('Application runtime was disposed')
          const controller = createImageController(service, queryClient)
          imageController = controller
          unsubscribeImage = controller.store.subscribe((next, previous) => {
            if (next.lastOpened !== previous.lastOpened)
              imageNavigation.setState({ lastOpened: next.lastOpened })
          })
          return controller
        })
        .catch((error: unknown) => {
          image = undefined
          throw error
        })
      return image
    },
    get imageController() {
      return imageController
    },
    queryClient,
    get sessionExitTarget() {
      return sessionExitTarget
    },
    clearSession(target = '/login') {
      // Publish the destination before synchronous session subscribers render their guards.
      sessionExitTarget = target
      service.clear()
    },
    dispose() {
      disposed = true
      unsubscribe()
      sessionState.dispose()
      chat.dispose()
      unsubscribeImage?.()
      imageController?.dispose()
      queryClient.clear()
    },
  }
}

export type AppRuntime = ReturnType<typeof createAppRuntime>
