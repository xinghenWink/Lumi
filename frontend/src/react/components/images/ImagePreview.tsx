import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageFile } from '../../../api/images'
import { useImageActions } from '../../features/images/actions'
import { cn } from '../../lib/utils'
import { ApiNotice } from '../shared/ApiNotice'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { ProtectedImage } from './ProtectedImage'

const control =
  'h-9 rounded-lg border border-white/15 bg-white/10 px-3 text-xs text-white shadow-none hover:bg-white/20 hover:text-white focus-visible:outline-white/80'
const fitZoom = 100
const minZoom = 50
const maxZoom = 200

/** Full-screen lightbox: arrows or keys move between results; 100% fits the screen. */
export function ImagePreview({
  files,
  initialIndex = 0,
  prompt,
  parameters,
  onClose,
  onEdit,
  onNavigate,
  returnFocus,
}: {
  files: ImageFile[]
  initialIndex?: number
  prompt: string
  parameters: string
  onClose(): void
  onEdit?: ((file: ImageFile) => void) | undefined
  onNavigate?: ((index: number) => void) | undefined
  returnFocus?: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation(),
    actions = useImageActions(),
    zoomField = useId()
  const [index, setIndex] = useState(initialIndex),
    [zoom, setZoom] = useState(fitZoom)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const frame = useRef<HTMLDivElement>(null),
    currentZoom = useRef(fitZoom),
    wheelAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null)
  const file = files[index]
  function selectZoom(value: number) {
    wheelAnchor.current = null
    currentZoom.current = value
    setZoom(value)
  }
  function move(direction: number) {
    if (files.length < 2) return
    const next = (index + direction + files.length) % files.length
    setIndex(next)
    selectZoom(fitZoom)
    onNavigate?.(next)
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement)
        return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        move(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })
  useEffect(() => {
    // The dialog mounts its portal after the preview component mounts.
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return
      event.preventDefault()
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientHeight
            : 1
      const next = Math.max(
        minZoom,
        Math.min(maxZoom, currentZoom.current * Math.exp(-event.deltaY * unit * 0.002)),
      )
      if (next === currentZoom.current) return
      const bounds = frame.current?.getBoundingClientRect()
      if (bounds?.width && bounds.height) {
        wheelAnchor.current = {
          x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
          y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
          clientX: event.clientX,
          clientY: event.clientY,
        }
      }
      currentZoom.current = next
      setZoom(next)
    }
    // Keep wheel zoom inside the preview without scrolling the surrounding viewport.
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [viewport])
  useLayoutEffect(() => {
    const anchor = wheelAnchor.current
    const bounds = frame.current?.getBoundingClientRect()
    if (!anchor || !viewport || !bounds) return
    wheelAnchor.current = null
    viewport.scrollBy({
      left: bounds.left + bounds.width * anchor.x - anchor.clientX,
      top: bounds.top + bounds.height * anchor.y - anchor.clientY,
      behavior: 'instant',
    })
  }, [viewport, zoom])
  const scale = zoom / 100
  const percent = Math.round(zoom)
  const zoomOptions = [...new Set([minZoom, fitZoom, 150, maxZoom, percent])].sort((a, b) => a - b)
  const aspect = file && file.width > 0 && file.height > 0 ? file.width / file.height : 1
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('images.preview')}
      description={parameters}
      variant="fullscreen"
      {...(returnFocus ? { returnFocus } : {})}
    >
      {file ? (
        <>
          <div className="flex h-14 shrink-0 items-center gap-3 pr-16 pl-4 text-xs text-white/70">
            {files.length > 1 ? (
              <span className="tabular-nums">
                {t('react.previewPosition', { index: index + 1, total: files.length })}
              </span>
            ) : null}
            <span className="truncate">{parameters}</span>
          </div>
          <div
            ref={setViewport}
            data-slot="image-preview-viewport"
            className="relative min-h-0 flex-1 overflow-auto overscroll-contain [container-type:size] [overflow-anchor:none]"
          >
            <div className="flex w-max min-h-full min-w-full p-4">
              <div
                ref={frame}
                className="m-auto shrink-0"
                style={{
                  width: `calc(${scale} * max(0px, min(100cqw - 2rem, (100cqh - 2rem) * ${aspect})))`,
                  aspectRatio: aspect,
                }}
              >
                <ProtectedImage
                  file={file}
                  original
                  alt={prompt || t('images.preview')}
                  className="size-full object-contain animate-fade-in"
                />
              </div>
            </div>
          </div>
          {files.length > 1 ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  control,
                  'absolute top-1/2 left-3 size-10 -translate-y-1/2 rounded-full px-0',
                )}
                aria-label={t('images.previous')}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={20} />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  control,
                  'absolute top-1/2 right-3 size-10 -translate-y-1/2 rounded-full px-0',
                )}
                aria-label={t('images.next')}
                onClick={() => move(1)}
              >
                <ChevronRight size={20} />
              </Button>
            </>
          ) : null}
          <div className="shrink-0 border-t border-white/10 bg-black/30 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
            {prompt ? (
              <p className="mb-3 line-clamp-2 max-w-4xl text-sm leading-6 break-words text-white/90">
                {prompt}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
              <label htmlFor={zoomField} className="flex items-center gap-2">
                {t('images.zoom')}
                <select
                  id={zoomField}
                  aria-label={t('images.zoom')}
                  className="h-9 rounded-lg border border-white/15 bg-white/10 px-2.5 text-xs text-white [color-scheme:dark] focus-visible:outline-2 focus-visible:outline-white/80"
                  value={percent}
                  onChange={(event) => selectZoom(Number(event.target.value))}
                >
                  {zoomOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}%
                    </option>
                  ))}
                </select>
              </label>
              <span className="mr-auto tabular-nums">
                {t('images.originalSize', { width: file.width, height: file.height })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className={control}
                onClick={() => {
                  void actions.download(file)
                }}
              >
                <Download size={14} />
                {t('images.download')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={control}
                onClick={() => {
                  void actions.copy(file)
                }}
              >
                <Copy size={14} />
                {t(actions.copied ? 'images.copied' : 'images.copy')}
              </Button>
              {onEdit ? (
                <Button
                  size="sm"
                  className="h-9 rounded-lg px-3"
                  onClick={() => {
                    onClose()
                    onEdit(file)
                  }}
                >
                  <Plus size={14} />
                  {t('images.edit')}
                </Button>
              ) : null}
            </div>
            {actions.error ? (
              <div className="mt-3 rounded-xl bg-card">
                <ApiNotice error={actions.error} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </ModalDialog>
  )
}
