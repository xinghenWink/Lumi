import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { AlertTriangle, ArrowLeft, Check, CloudOff, Loader2 } from 'lucide-react'
import type { ImageFile } from '../../../api/images'
import { canGenerate, LIMITS } from '../../../features/canvas/document'
import { boundsOf } from '../../../features/canvas/geometry'
import { insertFile } from '../../features/canvas/actions'
import { useCanvas, useEditor } from '../../features/canvas/context'
import { useImageConfig } from '../../features/images/config'
import { useImageActions } from '../../features/images/actions'
import { useMediaQuery } from '../../lib/media'
import { UploadNotice } from '../shared/ReferenceTray'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { CanvasViewport } from './CanvasViewport'
import type { CreateMenuAnchor } from './CanvasCreateMenu'
import { ThemeToggle } from '../shared/ThemeToggle'
import { CanvasToolbar, SelectionBar, ZoomControls } from './CanvasControls'
import { CanvasMiniMap } from './CanvasMiniMap'
import { GeneratorInspector } from './GeneratorInspector'
import type { Rejections } from '../../features/files/reference-rules'

const ImageLibrary = lazy(() =>
  import('../images/ImageLibrary').then((module) => ({ default: module.ImageLibrary })),
)
const ImagePreview = lazy(() =>
  import('../images/ImagePreview').then((module) => ({ default: module.ImagePreview })),
)

function SaveState() {
  const { t } = useTranslation()
  const { autosave } = useCanvas()
  const { status } = useStore(autosave.status)
  const icon =
    status === 'saving' ? (
      <Loader2 size={13} className="animate-spin" aria-hidden="true" />
    ) : status === 'saved' ? (
      <Check size={13} aria-hidden="true" />
    ) : status === 'retrying' || status === 'invalid' || status === 'missing' ? (
      <CloudOff size={13} aria-hidden="true" />
    ) : null
  const label = {
    saved: 'canvas.editor.saved',
    dirty: 'canvas.editor.dirty',
    saving: 'canvas.editor.saving',
    retrying: 'canvas.editor.retrying',
    conflict: 'canvas.editor.conflict',
    invalid: 'canvas.editor.invalid',
    missing: 'canvas.editor.missing',
  }[status]
  return (
    <span
      aria-live="polite"
      data-testid="canvas-save-state"
      data-status={status}
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{t(label)}</span>
    </span>
  )
}

function TitleField() {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const title = useEditor((state) => state.title)
  return (
    <input
      aria-label={t('canvas.editor.titleLabel')}
      value={title}
      maxLength={LIMITS.title}
      placeholder={t('canvas.editor.titlePlaceholder')}
      onChange={(event) => editor.setTitle(event.target.value)}
      onBlur={(event) => {
        const trimmed = event.target.value.trim()
        if (trimmed !== event.target.value) editor.setTitle(trimmed)
      }}
      className="h-8 min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-input focus:border-ring focus:bg-card sm:max-w-80"
    />
  )
}

function ConflictBanner() {
  const { t } = useTranslation()
  const { autosave } = useCanvas()
  const { status, error } = useStore(autosave.status)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  if (status !== 'conflict' && status !== 'missing') return null
  const resolve = (side: 'theirs' | 'mine') => {
    setBusy(true)
    setFailure(null)
    autosave
      .resolve(side)
      .catch((reason: unknown) => setFailure(reason))
      .finally(() => setBusy(false))
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"
    >
      <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
      <span className="flex-1">
        {status === 'missing' ? t('canvas.editor.missing') : t('canvas.editor.conflict')}
      </span>
      {status === 'conflict' ? (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve('theirs')}>
            {t('canvas.editor.reloadLatest')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => resolve('mine')}>
            {t('canvas.editor.keepMine')}
          </Button>
        </>
      ) : null}
      {failure || (status === 'missing' && error) ? (
        <div className="w-full">
          <ApiNotice error={failure ?? error} />
        </div>
      ) : null}
    </div>
  )
}

function Notice({ rejected, maxBytes }: { rejected: Rejections | null; maxBytes: number }) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const notice = useEditor((state) => state.notice)
  useEffect(() => {
    if (!notice || notice.error) return
    const timer = setTimeout(() => editor.notify(null), 5000)
    return () => clearTimeout(timer)
  }, [editor, notice])
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-20 z-20 flex flex-col items-center gap-2 sm:bottom-6">
      <UploadNotice
        notice={rejected}
        size={(maxBytes / 1_048_576).toLocaleString()}
        className="pointer-events-auto rounded-lg bg-card px-3 py-1.5 shadow-sm"
      />
      {notice ? (
        <div className="pointer-events-auto flex max-w-md items-start gap-2">
          {notice.error ? (
            <ApiNotice error={notice.error} />
          ) : (
            <p
              role="status"
              className="rounded-lg bg-foreground px-3 py-2 text-sm text-background shadow-md"
            >
              {t(notice.key, notice.values ?? {})}
            </p>
          )}
          {notice.error ? (
            <Button size="sm" variant="ghost" onClick={() => editor.notify(null)}>
              {t('common.close')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function CanvasEditor({ rejected }: { rejected: Rejections | null }) {
  const { t } = useTranslation()
  const services = useCanvas()
  const { editor } = services
  const wide = useMediaQuery('(min-width: 1024px)')
  const config = useImageConfig()
  const actions = useImageActions()
  const [library, setLibrary] = useState(false)
  const [preview, setPreview] = useState<ImageFile | null>(null)
  const [minimap, setMinimap] = useState(true)
  const [menu, setMenu] = useState<CreateMenuAnchor | null>(null)
  const inspectorId = useEditor((state) => state.inspector)
  const nodes = useEditor((state) => state.doc.nodes)
  const inspected = inspectorId ? nodes.find((node) => node.id === inspectorId) : undefined
  const panel = wide && inspected && canGenerate(inspected) ? inspected : undefined
  const sheet = !wide && inspected && canGenerate(inspected) ? inspected : undefined
  const maxBytes = config.data?.max_upload_bytes ?? 10 * 1_048_576
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 bg-card px-3 sm:px-4">
        <Link
          to="/canvas"
          aria-label={t('canvas.editor.back')}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{t('canvas.editor.back')}</span>
        </Link>
        <TitleField />
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <SaveState />
          <ThemeToggle />
        </div>
      </div>
      <ConflictBanner />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <CanvasViewport menu={menu} onMenu={setMenu} />
          <div className="absolute inset-x-2 top-2 z-10 w-fit sm:top-4 sm:left-4">
            <CanvasToolbar
              onLibrary={() => setLibrary(true)}
              onCreate={() => {
                const { stage } = editor.state
                setMenu(
                  menu
                    ? null
                    : {
                        point: {
                          x: Math.min(stage.width / 3, 160),
                          y: Math.min(stage.height / 3, 130),
                        },
                      },
                )
              }}
            />
          </div>
          <SelectionOverlay
            onPreview={setPreview}
            onDownload={(file) => void actions.download(file)}
          />
          {panel ? (
            <GeneratorOverlay node={panel} onClose={() => editor.openInspector(null)} />
          ) : null}
          <div className="absolute right-3 bottom-3 z-10 flex flex-col items-end gap-2">
            {minimap && wide ? <CanvasMiniMap /> : null}
            <ZoomControls
              minimap={minimap && wide}
              onMinimap={wide ? () => setMinimap((value) => !value) : undefined}
            />
          </div>
          <Notice rejected={rejected} maxBytes={maxBytes} />
        </div>
      </div>
      {sheet ? (
        <ModalDialog
          open
          variant="sheet"
          title={t('canvas.generator.heading')}
          description={t('canvas.generator.promptPlaceholder')}
          onOpenChange={(open) => {
            if (!open) editor.openInspector(null)
          }}
        >
          <div className="max-h-[70dvh] overflow-y-auto pt-2">
            <GeneratorInspector
              key={sheet.id}
              node={sheet}
              onClose={() => editor.openInspector(null)}
            />
          </div>
        </ModalDialog>
      ) : null}
      {library ? (
        <Suspense fallback={null}>
          <ImageLibrary
            maxUploadBytes={maxBytes}
            onClose={() => setLibrary(false)}
            onChoose={(file) => {
              insertFile(services.editor, file)
              setLibrary(false)
            }}
          />
        </Suspense>
      ) : null}
      {preview ? (
        <Suspense fallback={null}>
          <ImagePreview
            files={[preview]}
            prompt=""
            parameters={`${preview.width} × ${preview.height}`}
            onClose={() => setPreview(null)}
          />
        </Suspense>
      ) : null}
      <ApiNotice error={actions.error} />
    </div>
  )
}

function SelectionOverlay({
  onPreview,
  onDownload,
}: {
  onPreview(file: ImageFile): void
  onDownload(file: ImageFile): void
}) {
  const selection = useEditor((state) => state.selection)
  const nodes = useEditor((state) => state.doc.nodes)
  const viewport = useEditor((state) => state.viewport)
  const stage = useEditor((state) => state.stage)
  const wide = useMediaQuery('(min-width: 640px)')
  const bounds = boundsOf(nodes.filter((node) => selection.includes(node.id)))
  const x = bounds ? (bounds.x + bounds.w / 2) * viewport.zoom + viewport.x : stage.width / 2
  const y = bounds ? bounds.y * viewport.zoom + viewport.y : 72
  return (
    <div
      className="absolute z-10 -translate-x-1/2"
      style={{
        left: wide ? Math.max(174, Math.min(stage.width - 164, x)) : stage.width / 2,
        top: wide ? Math.max(12, Math.min(stage.height - 54, y - 52)) : 92,
      }}
    >
      <SelectionBar onPreview={onPreview} onDownload={onDownload} />
    </div>
  )
}

function GeneratorOverlay({
  node,
  onClose,
}: {
  node: Parameters<typeof GeneratorInspector>[0]['node']
  onClose(): void
}) {
  const viewport = useEditor((state) => state.viewport)
  const stage = useEditor((state) => state.stage)
  const width = 344
  const height = Math.min(550, stage.height - 64)
  const x = (node.x + node.w) * viewport.zoom + viewport.x + 16
  const left = node.x * viewport.zoom + viewport.x - width - 16
  const bottom = (node.y + node.h) * viewport.zoom + viewport.y + 12
  const beside = x + width < stage.width - 12 || left > 60
  return (
    <aside
      className="absolute z-10 overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-lg"
      style={{
        width,
        maxHeight: height,
        left: Math.max(
          60,
          Math.min(
            stage.width - width - 12,
            x + width < stage.width - 12 ? x : beside ? left : node.x * viewport.zoom + viewport.x,
          ),
        ),
        top: Math.max(
          12,
          Math.min(
            stage.height - height - 12,
            beside ? node.y * viewport.zoom + viewport.y : bottom,
          ),
        ),
      }}
    >
      <GeneratorInspector key={node.id} node={node} onClose={onClose} />
    </aside>
  )
}
