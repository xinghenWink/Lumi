import type { ImageTask } from '../../../api/images'

export const taskStatuses = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'canceled',
] as const satisfies readonly ImageTask['status'][]
export const datePresets = ['week', 'month', 'quarter'] as const

export type TaskFilters = {
  from: string
  until: string
  state: ImageTask['status'] | ''
  quality: ImageTask['quality'] | ''
}

export const emptyTaskFilters: TaskFilters = { from: '', until: '', state: '', quality: '' }

export function taskFilterQuery(search: string, filters: TaskFilters) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (filters.state) params.set('state', filters.state)
  if (filters.quality) params.set('quality', filters.quality)
  if (filters.from) params.set('from', new Date(filters.from + 'T00:00:00Z').toISOString())
  if (filters.until) {
    const end = new Date(filters.until + 'T00:00:00Z')
    end.setUTCDate(end.getUTCDate() + 1)
    params.set('until', end.toISOString())
  }
  return params.toString()
}

export function recentTaskDates(preset: (typeof datePresets)[number], now = new Date()) {
  const from = new Date(now)
  if (preset === 'week') {
    from.setUTCDate(from.getUTCDate() - 6)
  } else {
    const day = from.getUTCDate()
    from.setUTCMonth(from.getUTCMonth() - (preset === 'month' ? 1 : 3) + 1, 0)
    from.setUTCDate(Math.min(day, from.getUTCDate()))
  }
  return { from: from.toISOString().slice(0, 10), until: now.toISOString().slice(0, 10) }
}
