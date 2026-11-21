import { describe, expect, it, vi } from 'vitest'
import { emptyHistory, record, redo, undo } from '../../../features/canvas/history'
import type { Rect } from '../../../features/canvas/geometry'
import {
  eraseSketch,
  hasVisibleInk,
  moveElement,
  sketchPoint,
  traceShape,
  type Sketch,
  type SketchElement,
  type SketchShape,
} from './drawing'

describe('sketch drawing', () => {
  const expected: Record<SketchShape, Record<string, number>> = {
    line: { moveTo: 1, lineTo: 1 },
    arrow: { moveTo: 3, lineTo: 3 },
    rectangle: { rect: 1 },
    ellipse: { ellipse: 1 },
    triangle: { moveTo: 1, lineTo: 2, closePath: 1 },
    diamond: { moveTo: 1, lineTo: 3, closePath: 1 },
    star: { moveTo: 1, lineTo: 9, closePath: 1 },
    heart: { moveTo: 1, bezierCurveTo: 4, closePath: 1 },
  }
  it.each(Object.entries(expected))('traces the expected %s geometry', (name, calls) => {
    const path = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      bezierCurveTo: vi.fn(),
      closePath: vi.fn(),
    }
    traceShape(path, name as SketchShape, { x: 330, y: 100 }, { x: 70, y: 220 }, 12)
    for (const [method, spy] of Object.entries(path)) {
      expect(spy).toHaveBeenCalledTimes(calls[method] ?? 0)
      expect(spy.mock.calls.flat().every(Number.isFinite)).toBe(true)
    }
    if (name === 'rectangle') expect(path.rect).toHaveBeenCalledWith(70, 100, 260, 120)
  })

  it('projects pointer coordinates onto the same paper at different viewport sizes', () => {
    expect(sketchPoint({ x: 90, y: 380 }, { left: 10, top: 140, width: 320, height: 320 })).toEqual(
      { x: 256, y: 768 },
    )
    expect(sketchPoint({ x: 167, y: 401 }, { left: 7, top: -79, width: 640, height: 640 })).toEqual(
      { x: 256, y: 768 },
    )
    expect(sketchPoint({ x: -8, y: 820 }, { left: 0, top: 0, width: 320, height: 320 })).toEqual({
      x: 0,
      y: 1024,
    })
  })

  it('keeps a partial erasure anchored to the moved element and unaffected elements intact', () => {
    const makePen = (id: number, x: number): SketchElement => ({
      id,
      kind: 'pen',
      color: '#000000',
      offset: { x, y: 0 },
      erasures: [],
      points: [
        { x: 0, y: 5 },
        { x: 60, y: 5 },
      ],
      width: 10,
    })
    const line = makePen(1, 20)
    const distant = makePen(2, 200)
    const start = [line, distant]
    const bounds = (element: SketchElement): Rect => ({ x: element.offset.x, y: 0, w: 70, h: 10 })
    const erase = { points: [{ x: 40, y: 5 }], width: 12 }
    const edited = eraseSketch(start, erase, bounds)
    expect(edited[0]?.erasures).toEqual([{ stroke: erase, origin: { x: 20, y: 0 } }])
    expect(edited[1]).toBe(distant)
    expect(eraseSketch(start, { ...erase, points: [{ x: 500, y: 500 }] }, bounds)).toBe(start)
    const moved = moveElement(edited, 1, { x: 20, y: 7 })
    expect(moved[0]).toMatchObject({ offset: { x: 40, y: 7 }, erasures: edited[0]?.erasures })
    const history = record(record(emptyHistory<Sketch>(), start), edited)
    const undone = undo(history, moved)
    expect(undone?.value).toBe(edited)
    expect(undone && redo(undone.history, undone.value)?.value).toBe(moved)
    expect(undone && undo(undone.history, undone.value)?.value).toBe(start)
  })

  it('requires visible color on the white paper', () => {
    expect(hasVisibleInk(Uint8ClampedArray.of(0, 0, 0, 0, 255, 255, 255, 255))).toBe(false)
    expect(hasVisibleInk(Uint8ClampedArray.of(255, 255, 255, 255, 42, 215, 110, 10))).toBe(true)
  })
})
