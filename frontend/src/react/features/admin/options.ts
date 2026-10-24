import { ApiError } from '../../../api/transport'

export function parseRatioMapping(value: string): Record<string, string> {
  const mapping = new Map<string, string>()
  for (const line of value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const parts = line.split('='),
      ratio = parts[0]?.trim(),
      size = parts[1]?.trim()
    if (parts.length !== 2 || !ratio || !size || mapping.has(ratio))
      throw new ApiError('INVALID_INPUT')
    mapping.set(ratio, size)
  }
  return Object.fromEntries(mapping)
}
