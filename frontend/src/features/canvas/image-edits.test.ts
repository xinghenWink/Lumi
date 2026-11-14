import { describe, expect, it } from 'vitest'
import { cropPixels, gridCuts, scalePixels, splitPixels } from './image-edits'

describe('canvas image editing geometry', () => {
  it('converts a normalized crop to bounded source pixels', () => {
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 640, 480)).toEqual({
      x: 160,
      y: 240,
      w: 320,
      h: 240,
    })
  })
  it('covers each pixel once when splitting an odd-sized image with adjustable cuts', () => {
    expect(splitPixels(7, 5, [0.3], gridCuts(2))).toEqual([
      { x: 0, y: 0, w: 2, h: 3 },
      { x: 2, y: 0, w: 5, h: 3 },
      { x: 0, y: 3, w: 2, h: 2 },
      { x: 2, y: 3, w: 5, h: 2 },
    ])
  })
  it('preserves aspect ratio when enlarging on either axis', () => {
    expect(scalePixels(640, 320, 2048)).toEqual({ w: 2048, h: 1024 })
    expect(scalePixels(320, 640, 2048)).toEqual({ w: 1024, h: 2048 })
  })
})
