import { announcementReleaseTag } from './announcements'
import { array, boolean, integer, text } from './operations'
import { authorized } from './protected'
import type { components } from './schema'
import { ApiError, record } from './transport'

type AnnouncementReleasePage = components['schemas']['AnnouncementReleasePage']
export type AnnouncementRelease = AnnouncementReleasePage['items'][number]

function parseAnnouncementReleases(value: unknown): AnnouncementReleasePage {
  const data = record(value)
  return {
    items: array(data.items, (value) => {
      const release = record(value)
      const publishedAt = text(release.published_at)
      if (!Number.isFinite(Date.parse(publishedAt))) throw new ApiError('RESPONSE_INVALID')
      return {
        version: announcementReleaseTag(release.version),
        name: text(release.name),
        notes: text(release.notes),
        published_at: publishedAt,
      }
    }),
    next_page: integer(data.next_page),
    stale: boolean(data.stale),
  }
}

export function getAnnouncementReleases(page: number, signal: AbortSignal) {
  return authorized(
    `/api/v1/admin/announcements/github-releases?page=${page}&refresh=1`,
    parseAnnouncementReleases,
    { signal },
  )
}
