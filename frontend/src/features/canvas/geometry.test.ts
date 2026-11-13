import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  edgePath,
  fitBounds,
  normalizeRect,
  screenToWorld,
  visibleNodes,
  wheelZoom,
  worldToScreen,
  zoomAt,
} from './geometry'
import { textNode } from './document'

describe('canvas geometry', () => {
  it('round-trips screen and world coordinates', () => {
    const viewport = { x: 120, y: -40, zoom: 0.5 }
    const world = screenToWorld({ x: 220, y: 60 }, viewport)
    expect(world).toEqual({ x: 200, y: 200 })
    expect(worldToScreen(world, viewport)).toEqual({ x: 220, y: 60 })
  })

  it('zooms around the pointer and clamps the scale', () => {
    const viewport = { x: 10, y: 20, zoom: 1 }
    const point = { x: 300, y: 200 }
    const next = zoomAt(viewport, point, 2)
    expect(screenToWorld(point, next)).toEqual(screenToWorld(point, viewport))
    expect(zoomAt(viewport, point, 100).zoom).toBe(4)
    expect(zoomAt(viewport, point, 0).zoom).toBe(0.05)
    expect(wheelZoom(viewport, point, -100).zoom).toBeGreaterThan(1)
    expect(wheelZoom(viewport, point, 100).zoom).toBeLessThan(1)
  })

  it('fits content without zooming past 100%', () => {
    const size = { width: 1000, height: 800 }
    expect(fitBounds({ x: 0, y: 0, w: 100, h: 100 }, size).zoom).toBe(1)
    const fitted = fitBounds({ x: 0, y: 0, w: 4000, h: 1000 }, size)
    expect(fitted.zoom).toBeCloseTo((1000 - 128) / 4000)
    expect(fitBounds(null, size)).toEqual({ x: 500, y: 400, zoom: 1 })
  })

  it('computes bounds, marquee rectangles and visible nodes', () => {
    expect(boundsOf([])).toBeNull()
    expect(
      boundsOf([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: -5, y: 20, w: 10, h: 10 },
      ]),
    ).toEqual({ x: -5, y: 0, w: 15, h: 30 })
    expect(normalizeRect({ x: 10, y: 10 }, { x: 0, y: 4 })).toEqual({ x: 0, y: 4, w: 10, h: 6 })
    const near = textNode({ x: 0, y: 0 }),
      far = textNode({ x: 50_000, y: 0 })
    const shown = visibleNodes([near, far], { x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 })
    expect(shown).toEqual([near])
  })

  it('draws horizontal edges', () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 200, y: 50 })).toBe('M 0 0 C 100 0, 100 50, 200 50')
  })
})
