import { describe, expect, it } from 'vitest'
import { emptyTaskFilters, recentTaskDates, taskFilterQuery } from './task-filters'

describe('image task filters', () => {
  it('includes the whole end date and keeps all active conditions', () => {
    const filters = {
      from: '2026-11-17',
      until: '2026-11-17',
      state: 'partial',
      quality: 'high',
    } as const
    expect(Object.fromEntries(new URLSearchParams(taskFilterQuery('海边 %_\\', filters)))).toEqual({
      search: '海边 %_\\',
      state: 'partial',
      quality: 'high',
      from: '2026-11-17T00:00:00.000Z',
      until: '2026-11-18T00:00:00.000Z',
    })
    expect(taskFilterQuery('', emptyTaskFilters)).toBe('')
  })

  it('uses UTC calendar dates and clips month presets at month-end', () => {
    const now = new Date('2024-05-31T23:59:00Z')
    expect(recentTaskDates('week', now)).toEqual({ from: '2024-05-25', until: '2024-05-31' })
    expect(recentTaskDates('month', now)).toEqual({ from: '2024-04-30', until: '2024-05-31' })
    expect(recentTaskDates('quarter', now)).toEqual({ from: '2024-02-29', until: '2024-05-31' })
  })
})
