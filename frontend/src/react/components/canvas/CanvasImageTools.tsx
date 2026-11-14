import { useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { images, type ImageFile } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import {
  cropPixels,
  gridCuts,
  renderImage,
  scalePixels,
  splitPixels,
  type Crop,
} from '../../../features/canvas/image-edits'
import { LIMITS } from '../../../features/canvas/document'
import { appendImageEdits } from '../../features/canvas/actions'
import { useCanvas, useCanvasImage } from '../../features/canvas/context'
import { useImageConfig } from '../../features/images/config'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'

export type ImageTool = 'info' | 'crop' | 'split' | 'upscale'

export function CanvasImageTools({
  tool,
  nodeID,
  file,
  onClose,
}: {
  tool: ImageTool
  nodeID: string
  file: ImageFile
  onClose(): void
}) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const preview = useCanvasImage(file, 'thumb')
  const config = useImageConfig()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 1, h: 1 })
  const [vertical, setVertical] = useState(() => gridCuts(Math.min(2, file.width)))
  const [horizontal, setHorizontal] = useState(() => gridCuts(Math.min(2, file.height)))
  const [longEdge, setLongEdge] = useState(() =>
    Math.min(4096, Math.max(file.height, file.width) * 2),
  )
  const [sharp, setSharp] = useState(false)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const size = scalePixels(file.width, file.height, longEdge)
  const regions =
    tool === 'split'
      ? splitPixels(file.width, file.height, vertical, horizontal)
      : [cropPixels(tool === 'crop' ? crop : { x: 0, y: 0, w: 1, h: 1 }, file.width, file.height)]
  const unavailable =
    (tool === 'upscale' && longEdge <= Math.max(file.width, file.height)) ||
    (tool === 'split' && regions.length < 2)

  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const unit = (value: number) => Math.max(0, Math.min(1, value))
    return {
      x: unit((event.clientX - box.left) / box.width),
      y: unit((event.clientY - box.top) / box.height),
    }
  }

  async function apply() {
    const doc = editor.state.doc
    if (busy || unavailable) return
    if (
      doc.nodes.length + regions.length > LIMITS.nodes ||
      doc.edges.length + regions.length > LIMITS.edges
    ) {
      setError(new ApiError('CANVAS_DOCUMENT_LIMIT', 409))
      return
    }
    setBusy(true)
    setError(null)
    let source: ImageBitmap | undefined
    try {
      source = await createImageBitmap(await images.blob(file))
      const results: ImageFile[] = []
      for (const region of regions) {
        const blob = await renderImage(source, region, tool === 'upscale' ? size : region, sharp)
        if (config.data && blob.size > config.data.max_upload_bytes)
          throw new ApiError('FILE_TOO_LARGE', 413)
        results.push(
          await images.upload(new File([blob], 'canvas-image.png', { type: 'image/png' })),
        )
      }
      if (!appendImageEdits(editor, nodeID, results))
        throw new ApiError('CANVAS_DOCUMENT_LIMIT', 409)
      onClose()
    } catch (failure) {
      setError(failure instanceof ApiError ? failure : new ApiError('CANVAS_IMAGE_EDIT_FAILED'))
    } finally {
      source?.close()
      setBusy(false)
    }
  }

  return (
    <ModalDialog
      open
      busy={busy}
      title={t('canvas.imageTools.' + tool)}
      description={t(
        tool === 'info' ? 'canvas.imageTools.dimensions' : 'canvas.imageTools.output',
        { width: file.width, height: file.height },
      )}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {preview?.url ? (
        <div
          data-testid="canvas-image-tool-preview"
          className="relative mx-auto max-h-[45vh] max-w-full touch-none overflow-hidden rounded-xl bg-muted select-none"
          style={{
            aspectRatio: file.width + ' / ' + file.height,
            width: 'min(100%, ' + (40 * file.width) / file.height + 'vh)',
          }}
          onPointerDown={(event) => {
            if (tool !== 'crop' || busy || event.button !== 0) return
            origin.current = point(event)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const start = origin.current
            if (!start) return
            const end = point(event)
            setCrop({
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              w: Math.abs(start.x - end.x),
              h: Math.abs(start.y - end.y),
            })
          }}
          onPointerUp={() => {
            origin.current = null
          }}
          onPointerCancel={() => {
            origin.current = null
          }}
        >
          <img
            alt=""
            src={preview.url}
            draggable={false}
            className="pointer-events-none size-full object-fill"
          />
          {tool === 'crop' ? (
            <span
              className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_#0006]"
              style={{
                left: crop.x * 100 + '%',
                top: crop.y * 100 + '%',
                width: crop.w * 100 + '%',
                height: crop.h * 100 + '%',
              }}
            />
          ) : null}
          {tool === 'split' ? (
            <>
              {vertical.map((line, index) => (
                <span
                  key={index}
                  className="pointer-events-none absolute inset-y-0 w-px bg-white"
                  style={{ left: line * 100 + '%' }}
                />
              ))}
              {horizontal.map((line, index) => (
                <span
                  key={index}
                  className="pointer-events-none absolute inset-x-0 h-px bg-white"
                  style={{ top: line * 100 + '%' }}
                />
              ))}
            </>
          ) : null}
        </div>
      ) : preview?.failed ? (
        <p role="alert">{t('canvas.nodes.unavailable')}</p>
      ) : (
        <p role="status">{t('common.loading')}</p>
      )}
      {tool === 'crop' ? (
        <div className="mt-3 flex justify-between text-xs">
          <span>
            {t('canvas.imageTools.dimensions', { width: regions[0]?.w, height: regions[0]?.h })}
          </span>
          <button type="button" onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })}>
            {t('canvas.imageTools.reset')}
          </button>
        </div>
      ) : null}
      {tool === 'split' ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <SplitAxis
            name={t('canvas.imageTools.columns')}
            lines={vertical}
            onChange={setVertical}
            limit={Math.min(file.width, 4)}
          />
          <SplitAxis
            name={t('canvas.imageTools.rows')}
            lines={horizontal}
            onChange={setHorizontal}
            limit={Math.min(file.height, 4)}
          />
        </div>
      ) : null}
      {tool === 'upscale' ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <label className="grid gap-1">
            {t('canvas.imageTools.longEdge')}
            <select
              value={longEdge}
              onChange={(event) => setLongEdge(Number(event.target.value))}
              className="rounded-md border border-border bg-card p-1.5"
            >
              {[...new Set([1024, 2048, 3072, 4096, longEdge])]
                .sort((a, b) => a - b)
                .filter((edge) => edge === longEdge || edge > Math.max(file.width, file.height))
                .map((edge) => (
                  <option value={edge} key={edge}>
                    {edge}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={sharp}
              onChange={(event) => setSharp(event.target.checked)}
            />
            {t('canvas.imageTools.nearest')}
          </label>
          {unavailable ? (
            <span role="status">{t('canvas.imageTools.maxSize')}</span>
          ) : (
            <span>{t('canvas.imageTools.dimensions', { width: size.w, height: size.h })}</span>
          )}
        </div>
      ) : null}
      <ApiNotice error={error} />
      {tool !== 'info' ? (
        <Button
          type="button"
          className="mt-3 w-full"
          disabled={busy || unavailable || !preview?.url}
          onClick={() => void apply()}
        >
          {t(busy ? 'common.loading' : 'canvas.imageTools.apply')}
        </Button>
      ) : null}
    </ModalDialog>
  )
}

function SplitAxis({
  name,
  lines,
  onChange,
  limit,
}: {
  name: string
  lines: number[]
  onChange(value: number[]): void
  limit: number
}) {
  const { t } = useTranslation()
  return (
    <fieldset className="grid gap-1 text-xs">
      <label className="grid gap-1">
        {name}
        <select
          value={lines.length + 1}
          className="rounded-md border border-border bg-card p-1.5"
          onChange={(event) => onChange(gridCuts(Number(event.target.value)))}
        >
          {Array.from({ length: limit }, (_, index) => (
            <option value={index + 1} key={index}>
              {index + 1}
            </option>
          ))}
        </select>
      </label>
      {lines.map((line, index) => (
        <input
          key={index}
          type="range"
          aria-label={t('canvas.imageTools.splitLine', { name, index: index + 1 })}
          min={Math.ceil(((lines[index - 1] ?? 0) + 0.01) * 100)}
          max={Math.floor(((lines[index + 1] ?? 1) - 0.01) * 100)}
          value={Math.round(line * 100)}
          onChange={(event) =>
            onChange(
              lines.map((value, i) => (i === index ? Number(event.target.value) / 100 : value)),
            )
          }
        />
      ))}
    </fieldset>
  )
}
