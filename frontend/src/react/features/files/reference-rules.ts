import type { PublicModel } from '../../../api/catalog-contracts'
import type { ImageConfiguration } from '../../../api/images'

/** MIME types accepted by POST /api/v1/files for reference images. */
export const referenceTypes: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']
export const referenceAccept = referenceTypes.join(',')

export interface Rejections {
  type: number
  size: number
  limit: number
}

/** Splits candidate files into accepted uploads and per-reason rejection counts. */
export function screenFiles(
  files: Iterable<File>,
  available: number,
  maxBytes?: number,
): { accepted: File[]; rejected: Rejections } {
  const accepted: File[] = []
  const rejected: Rejections = { type: 0, size: 0, limit: 0 }
  for (const file of files) {
    if (!referenceTypes.includes(file.type)) rejected.type++
    else if (maxBytes !== undefined && file.size > maxBytes) rejected.size++
    else if (accepted.length >= Math.max(0, available)) rejected.limit++
    else accepted.push(file)
  }
  return { accepted, rejected }
}

/** Reference slots for an image model; zero when the model cannot edit. */
export function referenceCapacity(
  config: Pick<ImageConfiguration, 'max_references'> | undefined,
  model: Pick<PublicModel, 'capabilities'> | undefined,
) {
  return model?.capabilities.supports_edit
    ? Math.min(config?.max_references ?? 0, model.capabilities.max_reference_images)
    : 0
}

/** Prefers the selected model when it can edit, otherwise the first edit-capable model. */
export function pickEditModel<T extends Pick<PublicModel, 'capabilities'>>(
  selected: T | undefined,
  items: readonly T[],
): T | undefined {
  return selected?.capabilities.supports_edit
    ? selected
    : items.find((model) => model.capabilities.supports_edit)
}

export type ReferenceProblem = 'duplicate' | 'limit' | 'size'

/** Validates adding an already uploaded file to a draft's reference list. */
export function referenceProblem(
  file: { id: string; size: number },
  current: readonly string[],
  limit: number,
  maxBytes: number | undefined,
): ReferenceProblem | null {
  if (current.includes(file.id)) return 'duplicate'
  if (maxBytes === undefined || file.size > maxBytes) return 'size'
  if (current.length >= limit) return 'limit'
  return null
}

/** Returns image files from a clipboard or drag payload, ignoring text and other items. */
export function filesFrom(list: FileList | null | undefined): File[] {
  return Array.from(list ?? [])
}

/** True when a drag carries files rather than text or links. */
export function carriesFiles(transfer: DataTransfer | null | undefined) {
  return !!transfer && Array.from(transfer.types).includes('Files')
}

/** Pure drag depth reducer; nested dragenter/dragleave pairs must not flicker the overlay. */
export function dragDepth(depth: number, event: 'enter' | 'leave' | 'reset') {
  if (event === 'enter') return depth + 1
  if (event === 'leave') return Math.max(0, depth - 1)
  return 0
}
