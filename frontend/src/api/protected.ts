import { useAuthStore } from '../stores/auth'
import { request, ApiError, type RequestOptions } from './transport'

export async function authorized<T>(
  path: string,
  parse: (value: unknown) => T,
  options: RequestOptions = {},
): Promise<T> {
  const auth = useAuthStore()
  if (!auth.accessToken) await auth.refresh()
  try {
    return await request(path, parse, { ...options, token: auth.accessToken })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    await auth.refresh()
    return request(path, parse, { ...options, token: auth.accessToken })
  }
}
