import { ApiError, openResponse, request, type RequestOptions } from './transport'

export interface SessionSnapshot {
  token: string | null
  epoch: number
  revision: number
}

export interface SessionAdapter {
  snapshot(): SessionSnapshot
  refresh(): Promise<void>
}

// The composition root supplies the framework adapter; protocol clients never import UI stores.
export function createAuthorizedClient(resolveSession: () => SessionAdapter) {
  async function execute<T>(
    options: RequestOptions,
    perform: (token: string) => Promise<T>,
  ): Promise<T> {
    const session = resolveSession()
    const epoch = session.snapshot().epoch
    const assertCurrent = () => {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (session.snapshot().epoch !== epoch) throw new ApiError('AUTH_REQUIRED', 401)
    }
    assertCurrent()
    if (!session.snapshot().token) await session.refresh()
    assertCurrent()
    const initial = session.snapshot()
    if (!initial.token) throw new ApiError('AUTH_REQUIRED', 401)
    let result: T
    try {
      result = await perform(initial.token)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      assertCurrent()
      // A concurrent request may already have refreshed even when the JWT bytes are unchanged.
      if (session.snapshot().revision === initial.revision) await session.refresh()
      assertCurrent()
      const token = session.snapshot().token
      if (!token) throw new ApiError('AUTH_REQUIRED', 401)
      result = await perform(token)
    }
    if (session.snapshot().epoch !== epoch && result instanceof Response)
      await result.body?.cancel().catch(() => undefined)
    assertCurrent()
    return result
  }

  return {
    authorized<T>(
      path: string,
      parse: (value: unknown) => T,
      options: RequestOptions = {},
    ): Promise<T> {
      return execute(options, (token) => request(path, parse, { ...options, token }))
    },
    authorizedResponse(path: string, options: RequestOptions = {}): Promise<Response> {
      return execute(options, (token) => openResponse(path, { ...options, token }))
    },
  }
}
