import type { Announcement, AnnouncementType } from '../../../api/announcements'

export const announcementTypeKey = {
  system_update: 'announcement.systemUpdate',
  daily: 'announcement.daily',
} as const satisfies Record<AnnouncementType, string>

type History = { mode: 'history'; type: AnnouncementType; items: Announcement[] }
type Section = History | { mode: 'standalone'; item: Announcement }

export function announcementSections(items: readonly Announcement[]): Section[] {
  const sections: Section[] = []
  const histories = new Map<AnnouncementType, History>()
  for (const item of items) {
    if (item.display_mode === 'standalone') {
      sections.push({ mode: 'standalone', item })
      continue
    }
    const history = histories.get(item.announcement_type)
    if (history) history.items.push(item)
    else {
      const group: History = { mode: 'history', type: item.announcement_type, items: [item] }
      histories.set(group.type, group)
      sections.push(group)
    }
  }
  return sections
}
