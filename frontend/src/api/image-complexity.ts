import type { components } from './schema'
import { ApiError } from './transport'

export type ImageComplexity = components['schemas']['ImageComplexity']
export const imageComplexityLevels = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ImageComplexity[]

export function parseImageComplexity(value: unknown): ImageComplexity {
  const level = imageComplexityLevels.find((option) => value === option)
  if (!level) throw new ApiError('RESPONSE_INVALID')
  return level
}
