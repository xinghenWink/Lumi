import { ApiError } from './transport'

export const text = (v: unknown): string => {
  if (typeof v !== 'string') throw new ApiError('RESPONSE_INVALID')
  return v
}
export const integer = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    throw new ApiError('RESPONSE_INVALID')
  return v
}
