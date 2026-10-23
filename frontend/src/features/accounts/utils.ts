export function validPassword(value: string): boolean {
  const length = Array.from(value).length
  return length >= 8 && length <= 128 && /\p{L}/u.test(value) && /\p{Nd}/u.test(value)
}
export function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
}
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' && /^\/(chat|create|me|admin)(\/|\?|#|$)/.test(value)
    ? value
    : '/chat'
}
export function addDateRange(query: URLSearchParams, from: string, until: string) {
  if (from) query.set('from', new Date(`${from}T00:00:00Z`).toISOString())
  if (until) {
    const date = new Date(`${until}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 1)
    query.set('until', date.toISOString())
  }
}
