import { integer, text } from './response-fields'
import { authorized } from './protected'
import { ApiError, record } from './transport'

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  instructions: string
  image_quality: 'low' | 'medium' | 'high'
  image_ratio: string
  image_count: number
}

export function parsePreferences(v: unknown): Preferences {
  const d = record(v),
    theme = text(d.theme),
    quality = text(d.image_quality)
  if (!['light', 'dark', 'system'].includes(theme) || !['low', 'medium', 'high'].includes(quality))
    throw new ApiError('RESPONSE_INVALID')
  return {
    theme: theme as Preferences['theme'],
    instructions: text(d.instructions),
    image_quality: quality as Preferences['image_quality'],
    image_ratio: text(d.image_ratio),
    image_count: integer(d.image_count),
  }
}

export const userPreferences = {
  get: (signal?: AbortSignal) =>
    authorized('/api/v1/me/preferences', parsePreferences, signal ? { signal } : {}),
  save: (body: Preferences) =>
    authorized('/api/v1/me/preferences', parsePreferences, { method: 'PUT', body }),
}
