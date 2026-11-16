import type { ImageInput } from '../../../api/images'
import { ApiError } from '../../../api/transport'

export type EditorPoint = { x: number; y: number }
export type EditorShape = 'rectangle' | 'ellipse'
export type EditorMark =
  | { kind: 'pen' | 'erase'; points: EditorPoint[]; color: string; width: number }
  | { kind: EditorShape; from: EditorPoint; to: EditorPoint; color: string }
  | { kind: 'text'; at: EditorPoint; text: string; color: string }
  | { kind: 'comment'; at: EditorPoint; id: number; text: string }

export type EditorTool = EditorMark['kind']
export type EditorMode = 'markup' | 'erase' | 'remove_background' | 'resize'
export const editorRatios = ['1:1', '3:4', '9:16', '4:3', '16:9'] as const
export type EditorRatio = (typeof editorRatios)[number]
export type ImageEditorTarget = {
  conversationId: string
  modelId?: string
  quality?: ImageInput['quality']
  size?: string
  ratio?: string
}

export interface EditorHistory {
  past: EditorMark[][]
  marks: EditorMark[]
  future: EditorMark[][]
}

export function emptyEditorHistory(): EditorHistory {
  return { past: [], marks: [], future: [] }
}

export function changeMarks(history: EditorHistory, marks: EditorMark[]): EditorHistory {
  return { past: [...history.past.slice(-49), history.marks], marks, future: [] }
}

export function stepMarks(history: EditorHistory, direction: 'undo' | 'redo'): EditorHistory {
  const { past, marks, future } = history
  if (direction === 'undo' && past.length) {
    return { past: past.slice(0, -1), marks: past.at(-1) ?? [], future: [marks, ...future] }
  }
  if (direction === 'redo' && future.length) {
    return { past: [...past, marks], marks: future[0] ?? [], future: future.slice(1) }
  }
  return history
}

export function unit(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function validEditorRatio(width: number, height: number, ratio: EditorRatio) {
  const [x, y] = ratio.split(':').map(Number)
  return !!x && !!y && Math.abs(width * y - height * x) <= Math.max(x, y)
}

export function drawEditorMarks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  marks: readonly EditorMark[],
) {
  const scale = Math.min(width, height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const mark of marks) {
    ctx.globalAlpha = 1
    ctx.lineWidth = Math.max(1, scale * 0.004)
    if (mark.kind === 'comment') {
      const x = mark.at.x * width
      const y = mark.at.y * height
      const radius = Math.max(5, scale * 0.016)
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = '#172033'
      ctx.strokeStyle = '#ffffff'
      ctx.fill()
      ctx.stroke()
      ctx.font = 'bold ' + Math.round(radius * 1.18) + 'px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(String(mark.id), x, y, radius * 1.7)
      continue
    }
    ctx.strokeStyle = mark.color
    if (mark.kind === 'text') {
      const size = Math.max(8, scale * 0.035)
      ctx.font = 'bold ' + Math.round(size) + 'px sans-serif'
      ctx.textAlign = mark.at.x > 0.5 ? 'right' : 'left'
      ctx.textBaseline = mark.at.y > 0.5 ? 'bottom' : 'top'
      const x = mark.at.x * width,
        y = mark.at.y * height
      const space = mark.at.x > 0.5 ? x : width - x
      ctx.strokeStyle = '#172033'
      ctx.fillStyle = mark.color
      ctx.strokeText(mark.text, x, y, space)
      ctx.fillText(mark.text, x, y, space)
      continue
    }
    ctx.beginPath()
    if ('points' in mark) {
      const start = mark.points[0]
      if (!start) continue
      ctx.lineWidth = Math.max(1, mark.width * scale)
      ctx.globalAlpha = mark.kind === 'erase' ? 0.55 : 1
      ctx.moveTo(start.x * width, start.y * height)
      for (const point of mark.points.slice(1)) ctx.lineTo(point.x * width, point.y * height)
      if (mark.points.length === 1) ctx.lineTo(start.x * width + 0.01, start.y * height)
    } else {
      const x = mark.from.x * width,
        y = mark.from.y * height
      const w = (mark.to.x - mark.from.x) * width,
        h = (mark.to.y - mark.from.y) * height
      if (mark.kind === 'rectangle') ctx.rect(x, y, w, h)
      else ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

export async function renderEditorGuide(source: Blob, marks: readonly EditorMark[]): Promise<File> {
  const bitmap = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ApiError('IMAGE_EDIT_GUIDE_INVALID')
    ctx.drawImage(bitmap, 0, 0)
    drawEditorMarks(ctx, canvas.width, canvas.height, marks)
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new ApiError('IMAGE_EDIT_GUIDE_INVALID'))),
        'image/png',
      ),
    )
    return new File([png], 'edit-guide.png', { type: 'image/png' })
  } finally {
    bitmap.close()
    canvas.width = 0
    canvas.height = 0
  }
}
