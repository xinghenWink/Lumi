import { array, boolean, integer, text } from './operations'
import { authorized } from './protected'
import type { components } from './schema'
import { ApiError, noContent, record } from './transport'

export type Announcement = components['schemas']['Announcement']
export type AnnouncementType = components['schemas']['AnnouncementType']
export type AnnouncementDisplayMode = components['schemas']['AnnouncementDisplayMode']

export function parseAnnouncement(v: unknown): Announcement {
  const d = record(v)
  const type = d.announcement_type ?? 'daily'
  const mode = d.display_mode ?? 'standalone'
  if (
    (type !== 'daily' && type !== 'system_update') ||
    (mode !== 'standalone' && mode !== 'history')
  )
    throw new ApiError('RESPONSE_INVALID')
  return {
    id: text(d.id),
    content: text(d.content),
    starts_at: text(d.starts_at),
    ends_at: d.ends_at === null ? null : text(d.ends_at),
    enabled: boolean(d.enabled),
    version: integer(d.version),
    created_at: text(d.created_at),
    announcement_type: type,
    display_mode: mode,
    ...(d.github_release_tag === undefined
      ? {}
      : { github_release_tag: announcementReleaseTag(d.github_release_tag) }),
  }
}
export function announcementReleaseTag(value: unknown): string {
  const tag = text(value)
  if (!/^v(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(tag))
    throw new ApiError('RESPONSE_INVALID')
  return tag
}

const adminPath = '/api/v1/admin/announcements'

export const announcements = {
  list(view: 'admin' | 'feed', cursor: string, signal: AbortSignal, limit = 100) {
    const url = view === 'admin' ? adminPath : '/api/v1/announcements'
    const history = view === 'feed' ? '&include_history=1' : ''
    return authorized(
      `${url}?limit=${limit}&cursor=${encodeURIComponent(cursor)}${history}`,
      (value) => {
        const data = record(value)
        return { items: array(data.items, parseAnnouncement), next_cursor: text(data.next_cursor) }
      },
      { signal },
    )
  },
  save(body: components['schemas']['AnnouncementInput'], id?: string) {
    return authorized(adminPath + (id ? '/' + encodeURIComponent(id) : ''), parseAnnouncement, {
      method: id ? 'PUT' : 'POST',
      body,
    })
  },
  remove(id: string) {
    return authorized(adminPath + '/' + encodeURIComponent(id), noContent, { method: 'DELETE' })
  },
}
