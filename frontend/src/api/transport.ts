export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly requestId = '',
    public readonly retryAfter = 0,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

export interface RequestOptions {
  idempotencyKey?: string
  responseType?: 'blob'
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  token?: string | null
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ApiError('RESPONSE_INVALID')
  return value as Record<string, unknown>
}

export async function openResponse(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers()
  if (options.method && options.method !== 'GET') headers.set('X-Lumi-CSRF', '1')
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('NETWORK_ERROR')
  }
  if (!response.ok) {
    let code = 'UNKNOWN_ERROR'
    let requestId = response.headers.get('X-Request-ID') ?? ''
    try {
      const body = record(await response.json())
      if (typeof body.code === 'string') code = body.code
      if (typeof body.request_id === 'string') requestId = body.request_id
    } catch {
      /* Preserve a safe fallback for non-JSON proxy errors. */
    }
    throw new ApiError(
      code,
      response.status,
      requestId,
      Number(response.headers.get('Retry-After')) || 0,
    )
  }
  return response
}

export async function request<T>(
  path: string,
  parse: (value: unknown) => T,
  options: RequestOptions = {},
): Promise<T> {
  const response = await openResponse(path, options)
  if (response.status === 204) return parse(undefined)
  if (options.responseType === 'blob') {
    if (!response.headers.get('Content-Type')?.startsWith('text/csv'))
      throw new ApiError('RESPONSE_INVALID')
    return parse(await response.blob())
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new ApiError('RESPONSE_INVALID')
  }
  return parse(value)
}

export function noContent(value: unknown): void {
  if (value !== undefined) throw new ApiError('RESPONSE_INVALID')
}
