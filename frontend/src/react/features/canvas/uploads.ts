import { images, type ImageFile } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { addNodes, capacity, updateNode } from '../../../features/canvas/commands'
import { DEFAULT_SIZE, fitImage, imageNode, newId } from '../../../features/canvas/document'
import type { Point } from '../../../features/canvas/geometry'
import { screenFiles, type Rejections } from '../files/reference-rules'
import type { CanvasEditor, Placeholder } from './editor'

interface Placement {
  file: File
  item: Placeholder
  target?: string
  result?: { resolve(): void; reject(error: unknown): void }
}

const GAP = 24,
  CONCURRENCY = 2

export interface UploadHooks {
  rejected(rejections: Rejections): void
  upload?(file: File, signal: AbortSignal): Promise<ImageFile>
}

/** Lays images out in a row starting at a world point. */
export function rowAt(point: Point, count: number) {
  const { w, h } = DEFAULT_SIZE.image
  return Array.from({ length: count }, (_, index) => ({
    x: point.x + index * (w + GAP),
    y: point.y,
    w,
    h,
  }))
}

/**
 * Uploads dropped, pasted or picked files and places each as an image node where its
 * placeholder stood. Placeholders live outside the document so a failed upload never
 * reaches the server.
 */
export function createCanvasUploads(editor: CanvasEditor, hooks: UploadHooks) {
  const upload = hooks.upload ?? ((file: File, signal: AbortSignal) => images.upload(file, signal))
  const controllers = new Set<AbortController>()
  const queue: Placement[] = []
  let maxBytes: number | undefined
  let running = 0,
    failed = 0,
    active = false

  function finish(item: Placeholder) {
    editor.removePlaceholders([item.id])
    if (item.preview) URL.revokeObjectURL(item.preview)
  }

  function pump() {
    while (active && running < CONCURRENCY && queue.length) {
      const next = queue.shift()
      if (!next) break
      running += 1
      const controller = new AbortController()
      controllers.add(controller)
      upload(next.file, controller.signal)
        .then((file) => {
          if (!active || controller.signal.aborted)
            throw new DOMException('Upload canceled', 'AbortError')
          const size = fitImage(file.width, file.height)
          editor.addFiles([file])
          let inserted = ''
          const changed = editor.apply((doc) => {
            const content = {
              state: 'ready',
              file_id: file.id,
              task_id: null,
              position: null,
              error_code: '',
            } as const
            const image = imageNode({ x: next.item.rect.x, y: next.item.rect.y, ...size }, content)
            if (!next.target) {
              inserted = image.id
              return addNodes(doc, [image])
            }
            return updateNode(doc, next.target, (node) =>
              node.image && node.image.state !== 'pending'
                ? { ...node, h: fitImage(file.width, file.height, node.w).h, image: content }
                : node,
            )
          })
          if (next.result) {
            if (!changed) throw new ApiError('SKETCH_CANVAS_FULL')
            editor.select([inserted])
            next.result.resolve()
          }
        })
        .catch((error: unknown) => {
          if (next.result) next.result.reject(error)
          else if (active && !controller.signal.aborted) failed += 1
        })
        .finally(() => {
          controllers.delete(controller)
          running -= 1
          finish(next.item)
          if (active && !running && !queue.length && failed) {
            editor.notify({ key: 'canvas.upload.failed', values: { count: failed } })
            failed = 0
          }
          pump()
        })
    }
  }

  return {
    /** Sets the per-file size limit from the image configuration. */
    setMaxBytes(bytes: number | undefined) {
      maxBytes = bytes
    },
    /** Accepts files at a world position; returns how many will be uploaded. */
    place(files: readonly File[], at: Point, target?: string) {
      if (!active) return 0
      const pendingCount = editor.state.placeholders.length
      const node = target ? editor.state.doc.nodes.find((item) => item.id === target) : undefined
      const room = node ? 1 : capacity(editor.state.doc) - pendingCount
      const { accepted, rejected } = screenFiles(files, room, maxBytes)
      if (rejected.type || rejected.size || rejected.limit) hooks.rejected(rejected)
      if (rejected.limit && room <= 0) editor.notify({ key: 'canvas.editor.limit' })
      const rects = rowAt(at, accepted.length)
      const items = accepted.map((file, index): Placeholder => {
        const rect = node ?? rects[index] ?? { x: at.x, y: at.y, ...DEFAULT_SIZE.image }
        return { id: newId(), rect, preview: URL.createObjectURL(file) }
      })
      editor.addPlaceholders(items)
      accepted.forEach((file, index) => {
        const item = items[index]
        if (item) queue.push({ file, item, ...(node ? { target: node.id } : {}) })
      })
      pump()
      return accepted.length
    },
    /** Inserts a centered image and reports completion to the sketch editor. */
    placeSketch(file: File, center: Point) {
      return new Promise<void>((resolve, reject) => {
        if (!active) {
          reject(new ApiError('SKETCH_UPLOAD_UNAVAILABLE'))
          return
        }
        if (maxBytes !== undefined && file.size > maxBytes) {
          reject(new ApiError('FILE_TOO_LARGE'))
          return
        }
        if (capacity(editor.state.doc) <= editor.state.placeholders.length) {
          reject(new ApiError('SKETCH_CANVAS_FULL'))
          return
        }
        const size = fitImage(1, 1)
        const item = {
          id: newId(),
          rect: { x: center.x - size.w / 2, y: center.y - size.h / 2, ...size },
          preview: URL.createObjectURL(file),
        }
        editor.addPlaceholders([item])
        queue.push({ file, item, result: { resolve, reject } })
        pump()
      })
    },
    /** Accepts files until the cleanup cancels uploads still running. */
    mount() {
      active = true
      return () => {
        active = false
        for (const controller of controllers) controller.abort()
        controllers.clear()
        for (const { item, result } of queue.splice(0)) {
          finish(item)
          result?.reject(new DOMException('Upload canceled', 'AbortError'))
        }
      }
    },
  }
}
