import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { AlertTriangle, ArrowLeft, Check, CloudOff, Loader2 } from 'lucide-react'
import type { ImageFile } from '../../../api/images'
import { canGenerate, LIMITS } from '../../../features/canvas/document'
import { boundsOf } from '../../../features/canvas/geometry'
import { insertFile } from '../../features/canvas/actions'
import { useCanvas, useEditor } from '../../features/canvas/context'
import type { Preview } from '../../features/canvas/editor'
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
import { referenceAccept, type Rejections } from '../../features/files/reference-rules'
import { CanvasImageTools, type ImageTool } from './CanvasImageTools'
import type { CanvasNode } from '../../../api/canvases'

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
  const [imageTool, setImageTool] = useState<{
    tool: ImageTool
    node: CanvasNode
    file: ImageFile
  } | null>(null)
  const replaceTarget = useRef<CanvasNode | null>(null)
  const replacePicker = useRef<HTMLInputElement>(null)
  const [minimap, setMinimap] = useState(true)
  const [menu, setMenu] = useState<CreateMenuAnchor | null>(null)
  const inspectorId = useEditor((state) => state.inspector)
  const selection = useEditor((state) => state.selection)
  const editing = useEditor((state) => state.editing)
  const nodes = useEditor((state) => state.doc.nodes)
  const inspected =
    selection.length === 1 && selection[0] !== editing
      ? nodes.find((node) => node.id === selection[0])
      : undefined
  const closed = useEditor((state) => state.closedInspector)
  const panel =
    wide && inspected && canGenerate(inspected) && inspected.id !== closed ? inspected : undefined
  const sheet =
    !wide && inspected?.id === inspectorId && canGenerate(inspected) ? inspected : undefined
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
            onTool={(tool, node, file) => setImageTool({ tool, node, file })}
            onReplace={(node) => {
              replaceTarget.current = node
              replacePicker.current?.click()
            }}
          />
          {panel ? (
            <GeneratorOverlay node={panel} onClose={() => editor.closeInspector(panel.id)} />
          ) : null}
          <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2">
            {minimap && wide ? <CanvasMiniMap /> : null}
            <ZoomControls
              minimap={minimap && wide}
              onMinimap={wide ? () => setMinimap((value) => !value) : undefined}
            />
          </div>
          <Notice rejected={rejected} maxBytes={maxBytes} />
        </div>
      </div>
      <input
        ref={replacePicker}
        type="file"
        accept={referenceAccept}
        hidden
        aria-label={t('canvas.imageTools.replace')}
        onChange={(event) => {
          const target = replaceTarget.current
          if (target)
            services.uploads.place(Array.from(event.currentTarget.files ?? []), target, target.id)
          replaceTarget.current = null
          event.currentTarget.value = ''
        }}
      />
      {imageTool ? (
        <CanvasImageTools
          key={imageTool.tool + imageTool.node.id}
          tool={imageTool.tool}
          nodeID={imageTool.node.id}
          file={imageTool.file}
          onClose={() => setImageTool(null)}
        />
      ) : null}
      {sheet ? (
        <ModalDialog
          open
          variant="sheet"
          title={t(sheet.kind === 'text' ? 'canvas.prompt.textEditor' : 'canvas.generator.heading')}
          description={t(
            sheet.kind === 'text'
              ? 'canvas.prompt.textPlaceholder'
              : 'canvas.generator.promptPlaceholder',
          )}
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

function visualNode(node: CanvasNode, preview: Preview | null) {
  if (preview?.kind === 'move' && preview.ids.has(node.id))
    return { ...node, x: node.x + preview.dx, y: node.y + preview.dy }
  return preview?.kind === 'resize' && preview.id === node.id ? preview.rect : node
}

function SelectionOverlay({
  onPreview,
  onDownload,
  onTool,
  onReplace,
}: {
  onPreview(file: ImageFile): void
  onDownload(file: ImageFile): void
  onTool(tool: ImageTool, node: CanvasNode, file: ImageFile): void
  onReplace(node: CanvasNode): void
}) {
  const selection = useEditor((state) => state.selection)
  const nodes = useEditor((state) => state.doc.nodes)
  const viewport = useEditor((state) => state.viewport)
  const stage = useEditor((state) => state.stage)
  const preview = useEditor((state) => state.preview)
  const wide = useMediaQuery('(min-width: 640px)')
  const bounds = boundsOf(
    nodes.filter((node) => selection.includes(node.id)).map((node) => visualNode(node, preview)),
  )
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
      <SelectionBar
        onPreview={onPreview}
        onDownload={onDownload}
        onTool={onTool}
        onReplace={onReplace}
      />
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
  const preview = useEditor((state) => state.preview)
  const panel = useRef<HTMLElement>(null)
  const [height, setHeight] = useState(320)
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const content = element.firstElementChild
    const update = () => setHeight(element.scrollHeight + 2)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (content) observer.observe(content)
    return () => observer.disconnect()
  }, [node.id])
  const rect = visualNode(node, preview)
  const nodeLeft = rect.x * viewport.zoom + viewport.x
  const nodeRight = nodeLeft + rect.w * viewport.zoom
  const nodeTop = rect.y * viewport.zoom + viewport.y
  const below = Math.max(12, nodeTop + rect.h * viewport.zoom + 16)
  const above = Math.min(stage.height - 12, nodeTop - 64)
  const desiredHeight = Math.min(height, 420, stage.height - 24)
  const belowSpace = stage.height - 12 - below
  const aboveSpace = above - 12
  const leftSpace = nodeLeft - 82
  const rightSpace = stage.width - nodeRight - 28
  const side =
    Math.max(aboveSpace, belowSpace) < desiredHeight && Math.max(leftSpace, rightSpace) >= 330
  const width = Math.min(590, stage.width - 100, side ? Math.max(leftSpace, rightSpace) : Infinity)
  const maxHeight = side
    ? desiredHeight
    : Math.min(desiredHeight, Math.max(124, aboveSpace, belowSpace))
  const left = side
    ? rightSpace >= leftSpace
      ? nodeRight + 16
      : nodeLeft - width - 16
    : Math.max(66, Math.min(stage.width - width - 12, (nodeLeft + nodeRight - width) / 2))
  const top = side
    ? Math.max(12, Math.min(stage.height - maxHeight - 12, nodeTop))
    : belowSpace >= maxHeight
      ? below
      : Math.max(12, above - maxHeight)
  return (
    <aside
      ref={panel}
      className="absolute z-10 overflow-y-auto rounded-2xl border border-border bg-card p-3 shadow-lg sm:p-4"
      style={{
        width: Math.max(0, width),
        left,
        top,
        maxHeight,
      }}
    >
      <GeneratorInspector key={node.id} node={node} onClose={onClose} />
    </aside>
  )
}
