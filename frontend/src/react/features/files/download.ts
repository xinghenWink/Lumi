import { useEffect, useRef } from 'react'
import { authorizedResponse } from '../../../api/protected'
import { ApiError, type RequestOptions } from '../../../api/transport'
import { useRuntime } from '../../app/context'

export function usePrivateDownload() {
  const runtime = useRuntime(),
    controllers = useRef(new Set<AbortController>()),
    urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const cleanup = () => {
      for (const controller of controllers.current) controller.abort()
      controllers.current.clear()
      for (const [url, timer] of urls.current) {
        clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      urls.current.clear()
    }
    let epoch = runtime.session.snapshot().epoch,
      owner = runtime.session.getSnapshot().user?.id
    const unsubscribe = runtime.session.subscribe(() => {
      const next = runtime.session.getSnapshot()
      if (epoch !== next.epoch || owner !== next.user?.id) {
        cleanup()
        epoch = next.epoch
        owner = next.user?.id
      }
    })
    return () => {
      cleanup()
      unsubscribe()
    }
  }, [runtime])
  return async (path: string, filename: string, options: RequestOptions = {}) => {
    const epoch = runtime.session.snapshot().epoch,
      owner = runtime.session.getSnapshot().user?.id,
      controller = new AbortController()
    controllers.current.add(controller)
    try {
      const response = await authorizedResponse(path, { ...options, signal: controller.signal })
      if (
        options.responseType === 'blob' &&
        !response.headers.get('Content-Type')?.startsWith('text/csv')
      ) {
        controller.abort()
        throw new ApiError('RESPONSE_INVALID')
      }
      const blob = await response.blob()
      if (
        controller.signal.aborted ||
        !owner ||
        owner !== runtime.session.getSnapshot().user?.id ||
        epoch !== runtime.session.snapshot().epoch
      )
        throw new ApiError('AUTH_REQUIRED', 401)
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      urls.current.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url)
          urls.current.delete(url)
        }, 1000),
      )
    } finally {
      controllers.current.delete(controller)
    }
  }
}
