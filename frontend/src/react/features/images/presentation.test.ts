import { describe, expect, it } from 'vitest'
import { elapsedSeconds, ratioBox, statusTone, taskAspect } from './presentation'

describe('image presentation', () => {
  it('prefers stored dimensions, then requested size, then ratio', () => {
    const task = { size: '1536x1024', ratio: '1:1' }
    expect(taskAspect(task, { thumbnail_width: 512, thumbnail_height: 1024 })).toBe(0.5)
    expect(taskAspect(task)).toBe(1.5)
    expect(taskAspect({ size: 'auto', ratio: '16:9' })).toBeCloseTo(16 / 9)
    expect(taskAspect({ size: 'auto', ratio: '' })).toBe(1)
    expect(
      taskAspect({ size: '0x0', ratio: 'x' }, { thumbnail_width: 0, thumbnail_height: 0 }),
    ).toBe(1)
  })

  it('clamps extreme aspect ratios', () => {
    expect(taskAspect({ size: '4000x100', ratio: '' })).toBeCloseTo(21 / 9)
    expect(taskAspect({ size: '100x4000', ratio: '' })).toBeCloseTo(9 / 21)
  })

  it('maps statuses to tones', () => {
    expect(statusTone('queued')).toBe('active')
    expect(statusTone('running')).toBe('active')
    expect(statusTone('succeeded')).toBe('success')
    expect(statusTone('partial')).toBe('warning')
    expect(statusTone('failed')).toBe('danger')
    expect(statusTone('canceled')).toBe('muted')
  })

  it('measures elapsed time and freezes it when finished', () => {
    const created_at = '2026-01-01T00:00:00Z'
    const now = Date.parse('2026-01-01T00:00:12.900Z')
    expect(elapsedSeconds({ created_at, started_at: null, finished_at: null }, now)).toBe(12)
    expect(
      elapsedSeconds(
        { created_at, started_at: '2026-01-01T00:00:02Z', finished_at: '2026-01-01T00:00:07Z' },
        now,
      ),
    ).toBe(5)
    expect(elapsedSeconds({ created_at: 'bad', started_at: null, finished_at: null }, now)).toBe(0)
    expect(elapsedSeconds({ created_at, started_at: null, finished_at: null }, 0)).toBe(0)
  })

  it('fits ratio previews into a square', () => {
    expect(ratioBox('3:2')).toEqual({ width: 18, height: 12 })
    expect(ratioBox('9:16')).toEqual({ width: 10, height: 18 })
    expect(ratioBox('1:1')).toEqual({ width: 18, height: 18 })
    expect(ratioBox('nonsense')).toEqual({ width: 18, height: 18 })
  })
})
