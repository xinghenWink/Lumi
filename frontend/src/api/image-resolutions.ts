import type { components } from './schema'

export type ImageResolution = components['schemas']['ImageResolution']
export const imageResolutions = ['1k', '2k', '4k'] as const satisfies readonly ImageResolution[]

export function isImageResolution(value: unknown): value is ImageResolution {
  return imageResolutions.some((resolution) => resolution === value)
}

// System presets carry their tier. Use the longest edge for other fixed sizes.
export function customSizeResolution(size: string): ImageResolution | undefined {
  if (!/^[1-9][0-9]*x[1-9][0-9]*$/.test(size)) return undefined
  const [width = 0, height = 0] = size.split('x').map(Number)
  const edge = Math.max(width, height)
  if (edge <= 1536) return '1k'
  if (edge <= 2560) return '2k'
  return '4k'
}
