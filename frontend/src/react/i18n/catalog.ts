// Vue's literal escapes are data syntax, not part of the translated text.
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\{'([^']*)'\}/g, '$1')
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
  return value
}

export function catalog(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
}
