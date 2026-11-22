import type { TFunction } from 'i18next'
import type { ImageTask } from '../../../api/images'

export function taskParameters(task: ImageTask, t: TFunction) {
  return [
    task.model_name,
    t('images.' + task.quality),
    task.complexity
      ? t('images.complexitySummary', { level: t('images.complexityLevels.' + task.complexity) })
      : '',
    task.size === 'auto' ? t('images.auto') : task.size,
    task.ratio === 'auto' ? '' : task.ratio,
    task.output_format === 'gif' || task.items.some((item) => item.file?.mime === 'image/gif')
      ? t('images.outputFormatGif')
      : '',
    t('react.imageCount', { count: task.n }),
  ]
    .filter(Boolean)
    .join(' · ')
}

const pair = (value: string, separator: string) => {
  const [width, height] = value.split(separator).map(Number)
  return width && height && width > 0 && height > 0 ? width / height : undefined
}

/**
 * Aspect ratio for a result tile: the stored image when available, otherwise the
 * requested size or ratio, clamped so extreme requests still lay out sensibly.
 */
export function taskAspect(
  task: Pick<ImageTask, 'size' | 'ratio'>,
  file?: { thumbnail_width: number; thumbnail_height: number } | null,
) {
  const value =
    (file && file.thumbnail_width > 0 && file.thumbnail_height > 0
      ? file.thumbnail_width / file.thumbnail_height
      : undefined) ??
    pair(task.size, 'x') ??
    pair(task.ratio, ':') ??
    1
  return Math.min(21 / 9, Math.max(9 / 21, value))
}

export type StatusTone = 'active' | 'success' | 'warning' | 'danger' | 'muted'

export function statusTone(status: ImageTask['status']): StatusTone {
  if (status === 'queued' || status === 'running') return 'active'
  if (status === 'succeeded') return 'success'
  if (status === 'partial') return 'warning'
  if (status === 'failed') return 'danger'
  return 'muted'
}

/** Whole seconds a task has been queued or running; frozen once it finishes. */
export function elapsedSeconds(
  task: Pick<ImageTask, 'created_at' | 'started_at' | 'finished_at'>,
  now: number,
) {
  const start = Date.parse(task.started_at ?? task.created_at)
  const end = task.finished_at ? Date.parse(task.finished_at) : now
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.floor((end - start) / 1000))
    : 0
}

/** Parses "3:2" into a box that fits within `max` pixels, for ratio previews. */
export function ratioBox(ratio: string, max = 18) {
  const value = pair(ratio, ':') ?? 1
  return value >= 1
    ? { width: max, height: Math.max(6, Math.round(max / value)) }
    : { width: Math.max(6, Math.round(max * value)), height: max }
}
