import type { components } from './schema'
import { ApiError } from './transport'

export const imageQualities = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly components['schemas']['ImageQuality'][]

export function parseImageQuality(value: unknown) {
  const quality = imageQualities.find((option) => value === option)
  if (quality === undefined) throw new ApiError('RESPONSE_INVALID')
  return quality
}
