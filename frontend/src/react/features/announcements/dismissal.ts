export type Dismissal = 'current' | 'today'

function storageKey(userId: string, dismissal: Dismissal) {
  return `lumi.announcements.${dismissal}.${userId}`
}

function localDay(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function announcementSessionId(token: string | null): string | null {
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    // The session family survives token rotation and is used only for UI preferences.
    const claims: unknown = JSON.parse(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof claims !== 'object' || claims === null || !('sid' in claims)) return null
    const { sid } = claims
    return typeof sid === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(sid)
      ? sid
      : null
  } catch {
    return null
  }
}

export function isAnnouncementDismissed(
  userId: string,
  sessionId: string | null,
  now = new Date(),
) {
  try {
    return (
      localStorage.getItem(storageKey(userId, 'today')) === localDay(now) ||
      (sessionId !== null && localStorage.getItem(storageKey(userId, 'current')) === sessionId)
    )
  } catch {
    return false
  }
}

export function dismissAnnouncement(
  userId: string,
  sessionId: string | null,
  dismissal: Dismissal,
  now = new Date(),
) {
  const value = dismissal === 'today' ? localDay(now) : sessionId
  if (!value) return
  try {
    localStorage.setItem(storageKey(userId, dismissal), value)
  } catch {
    // Closing still works in memory when browser storage is unavailable.
  }
}
