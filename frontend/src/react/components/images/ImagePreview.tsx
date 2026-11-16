import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageFile } from '../../../api/images'
import { useImageActions } from '../../features/images/actions'
import type { ImageEditorTarget } from '../../features/images/editor'
import { useImageEditorDraft } from '../../features/images/editor-state'
import { cn } from '../../lib/utils'
import { ApiNotice } from '../shared/ApiNotice'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { NativeSelect, NativeSelectOption } from '../ui/native-select'
import { ProtectedImage } from './ProtectedImage'
import { ImageEditorControls } from './ImageEditorControls'
import { ImageEditorLayer } from './ImageEditorLayer'

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
  editor,
}: {
  files: ImageFile[]
  initialIndex?: number
  prompt: string
  parameters: string
  onClose(): void
  onEdit?: ((file: ImageFile) => void) | undefined
  onNavigate?: ((index: number) => void) | undefined
  returnFocus?: RefObject<HTMLElement | null>
  editor?: ImageEditorTarget
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
  const draft = useImageEditorDraft()
  const [discard, setDiscard] = useState<'close' | 'reference' | number | null>(null)
  const actionLabel = editor ? 'max-sm:sr-only' : ''
  const previewAction = cn(control, editor && 'max-sm:size-9 max-sm:px-0')
  function selectZoom(value: number) {
    wheelAnchor.current = null
    currentZoom.current = value
    setZoom(value)
  }
  function navigateTo(next: number) {
    draft.reset()
    setIndex(next)
    selectZoom(fitZoom)
    onNavigate?.(next)
  }
  function move(direction: number) {
    if (files.length < 2 || draft.busy || discard !== null) return
    const next = (index + direction + files.length) % files.length
    if (editor && draft.dirty) setDiscard(next)
    else navigateTo(next)
  }

  function requestClose() {
    if (editor && draft.dirty) setDiscard('close')
    else onClose()
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input, select, textarea, canvas, [role="menu"], [contenteditable="true"]',
          ))
      )
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
    <>
      <ModalDialog
        open
        onOpenChange={(value) => {
          if (!value) requestClose()
        }}
        busy={draft.busy}
        title={t('images.preview')}
        description={parameters}
        variant="fullscreen"
        {...(returnFocus ? { returnFocus } : {})}
      >
        {file ? (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 pr-16 pl-4 text-xs text-white/80">
              {files.length > 1 ? (
                <span className="shrink-0 whitespace-nowrap tabular-nums">
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
                  className="relative m-auto grid shrink-0 place-items-center"
                  style={{
                    width: `calc(${scale} * max(0px, min(100cqw - 2rem, (100cqh - 2rem) * ${aspect})))`,
                    aspectRatio: aspect,
                  }}
                >
                  <ProtectedImage
                    file={file}
                    original
                    alt={prompt || t('images.preview')}
                    className="absolute inset-0 size-full object-contain animate-fade-in"
                    {...(editor
                      ? {
                          renderImage: (image) => (
                            <>
                              {image}
                              <ImageEditorLayer key={file.id} draft={draft} />
                            </>
                          ),
                        }
                      : {})}
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
                  disabled={draft.busy}
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
                  disabled={draft.busy}
                  onClick={() => move(1)}
                >
                  <ChevronRight size={20} />
                </Button>
              </>
            ) : null}
            <div
              className={cn(
                'shrink-0 border-t border-white/10 bg-black/30 px-4 pt-2 backdrop-blur',
                editor ? 'pb-2' : 'pb-[max(12px,env(safe-area-inset-bottom))]',
              )}
            >
              {prompt && !editor ? (
                <p className="mb-3 line-clamp-2 max-w-4xl text-sm leading-6 break-words text-white/90">
                  {prompt}
                </p>
              ) : null}
              <div
                className={cn(
                  'flex flex-wrap items-center gap-2 text-xs text-white/70',
                  editor && 'max-sm:flex-nowrap',
                )}
              >
                <label
                  htmlFor={zoomField}
                  className="flex items-center gap-2 [&_[data-slot=native-select-wrapper]]:w-auto"
                >
                  <span className={actionLabel}>{t('images.zoom')}</span>
                  <NativeSelect
                    id={zoomField}
                    aria-label={t('images.zoom')}
                    className="h-9 rounded-lg border border-white/15 bg-white/10 pl-2.5 pr-9 text-xs text-white [color-scheme:dark] focus-visible:outline-2 focus-visible:outline-white/80"
                    value={percent}
                    onChange={(event) => selectZoom(Number(event.target.value))}
                  >
                    {zoomOptions.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {value}%
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <span className={cn('mr-auto tabular-nums', actionLabel)}>
                  {t('images.originalSize', { width: file.width, height: file.height })}
                </span>
                {editor ? <span className="flex-1 sm:hidden" aria-hidden="true" /> : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className={previewAction}
                  title={t('images.download')}
                  onClick={() => {
                    void actions.download(file)
                  }}
                >
                  <Download size={14} />
                  <span className={actionLabel}>{t('images.download')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={previewAction}
                  title={t(actions.copied ? 'images.copied' : 'images.copy')}
                  onClick={() => {
                    void actions.copy(file)
                  }}
                >
                  <Copy size={14} />
                  <span className={actionLabel}>
                    {t(actions.copied ? 'images.copied' : 'images.copy')}
                  </span>
                </Button>
                {onEdit ? (
                  <Button
                    size="sm"
                    className={cn('h-9 rounded-lg px-3', editor && 'max-sm:size-9 max-sm:px-0')}
                    title={t('images.edit')}
                    disabled={draft.busy}
                    onClick={() => {
                      if (draft.dirty) {
                        setDiscard('reference')
                        return
                      }
                      onClose()
                      onEdit(file)
                    }}
                  >
                    <Plus size={14} />
                    <span className={actionLabel}>{t('images.edit')}</span>
                  </Button>
                ) : null}
              </div>
              {actions.error ? (
                <div className="mt-3 rounded-xl bg-card">
                  <ApiNotice error={actions.error} />
                </div>
              ) : null}
            </div>
            {editor ? (
              <ImageEditorControls
                key={file.id}
                file={file}
                target={editor}
                draft={draft}
                onDone={onClose}
              />
            ) : null}
          </>
        ) : null}
      </ModalDialog>
      {discard !== null ? (
        <ModalDialog
          open
          title={t('images.editor.discardTitle')}
          description={t('images.editor.discardDescription')}
          onOpenChange={(value) => {
            if (!value) setDiscard(null)
          }}
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDiscard(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscard(null)
                if (typeof discard === 'number') {
                  navigateTo(discard)
                } else {
                  onClose()
                  if (discard === 'reference' && file) onEdit?.(file)
                }
              }}
            >
              {t('images.editor.discard')}
            </Button>
          </div>
        </ModalDialog>
      ) : null}
    </>
  )
}
