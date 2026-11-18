import { authorized } from './protected'
import { ApiError, record } from './transport'

export const hasActiveAnnouncement = (signal: AbortSignal) =>
  authorized(
    '/api/v1/announcements?limit=1',
    (value) => {
      const { items } = record(value)
      if (!Array.isArray(items)) throw new ApiError('RESPONSE_INVALID')
      return items.length > 0
    },
    { signal },
  )
