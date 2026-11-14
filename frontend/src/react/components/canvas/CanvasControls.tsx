import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpToLine,
  Copy,
  Download,
  Eye,
  Frame,
  Hand,
  ImagePlus,
  Images,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Map as MapIcon,
} from 'lucide-react'
import type { ImageFile } from '../../../api/images'
import { referenceAccept } from '../../features/files/reference-rules'
import { useCanvas, useEditor } from '../../features/canvas/context'
import {
  addGenerator,
  addText,
  duplicateSelection,
  fitAll,
  generateFromSelection,
  groupSelection,
  raiseSelection,
  removeSelection,
  resetZoom,
  stageCenter,
  ungroupSelection,
  zoomBy,
} from '../../features/canvas/actions'
import { cn } from '../../lib/utils'

export function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-accent text-primary',
      )}
    >
      {children}
    </button>
  )
}

const panel = 'rounded-xl border border-border bg-card/95 p-1 shadow-md backdrop-blur-sm'

export function CanvasToolbar({ onLibrary, onCreate }: { onLibrary(): void; onCreate(): void }) {
  const { t } = useTranslation()
  const services = useCanvas()
  const { editor, uploads } = services
  const tool = useEditor((state) => state.tool)
  const canUndo = useEditor((state) => state.history.past.length > 0)
  const canRedo = useEditor((state) => state.history.future.length > 0)
  const picker = useRef<HTMLInputElement>(null)
  return (
    <div
      role="toolbar"
      aria-label={t('canvas.tools.toolbar')}
      aria-orientation="vertical"
      className={cn(panel, 'flex flex-wrap gap-0.5 sm:flex-col')}
    >
      <ToolButton
        label={t('canvas.tools.select')}
        active={tool === 'select'}
        onClick={() => editor.setTool('select')}
      >
        <MousePointer2 size={17} />
      </ToolButton>
      <ToolButton
        label={t('canvas.tools.hand')}
        active={tool === 'hand'}
        onClick={() => editor.setTool('hand')}
      >
        <Hand size={17} />
      </ToolButton>
      <span className="mx-1.5 my-1 h-px bg-border" aria-hidden="true" />
      <ToolButton label={t('canvas.tools.create')} onClick={onCreate}>
        <Plus size={17} />
      </ToolButton>
      <ToolButton label={t('canvas.tools.text')} onClick={() => addText(editor)}>
        <Type size={17} />
      </ToolButton>
      <ToolButton label={t('canvas.tools.generator')} onClick={() => addGenerator(editor)}>
        <Sparkles size={17} />
      </ToolButton>
      <ToolButton label={t('canvas.tools.upload')} onClick={() => picker.current?.click()}>
        <ImagePlus size={17} />
      </ToolButton>
      <ToolButton label={t('canvas.tools.library')} onClick={onLibrary}>
        <Images size={17} />
      </ToolButton>
      <span className="mx-1.5 my-1 h-px bg-border" aria-hidden="true" />
      <ToolButton label={t('canvas.tools.undo')} disabled={!canUndo} onClick={() => editor.undo()}>
        <Undo2 size={17} />
      </ToolButton>
      <ToolButton label={t('canvas.tools.redo')} disabled={!canRedo} onClick={() => editor.redo()}>
        <Redo2 size={17} />
      </ToolButton>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept={referenceAccept}
        aria-label={t('canvas.tools.upload')}
        data-testid="canvas-upload-input"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length) uploads.place(files, stageCenter(editor))
        }}
      />
    </div>
  )
}

/** The minimap toggle is omitted where the minimap cannot be shown. */
export function ZoomControls({
  minimap,
  onMinimap,
}: {
  minimap: boolean
  onMinimap?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const zoom = useEditor((state) => state.viewport.zoom)
  const percent = Math.round(zoom * 100)
  return (
    <div className={cn(panel, 'flex items-center gap-0.5')}>
      {onMinimap ? (
        <ToolButton label={t('canvas.tools.minimap')} active={minimap} onClick={onMinimap}>
          <MapIcon size={16} />
        </ToolButton>
      ) : null}
      <ToolButton label={t('canvas.tools.zoomOut')} onClick={() => zoomBy(editor, 1 / 1.2)}>
        <Minus size={16} />
      </ToolButton>
      <button
        type="button"
        title={t('canvas.tools.zoomReset')}
        aria-label={t('canvas.tools.zoom', { percent })}
        onClick={() => resetZoom(editor)}
        className="h-9 min-w-14 rounded-lg px-2 text-xs font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {percent}%
      </button>
      <ToolButton label={t('canvas.tools.zoomIn')} onClick={() => zoomBy(editor, 1.2)}>
        <Plus size={16} />
      </ToolButton>
      <ToolButton label={t('canvas.tools.fit')} onClick={() => fitAll(editor)}>
        <Maximize size={16} />
      </ToolButton>
    </div>
  )
}

export function SelectionBar({
  onPreview,
  onDownload,
}: {
  onPreview(file: ImageFile): void
  onDownload(file: ImageFile): void
}) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const selection = useEditor((state) => state.selection)
  const edges = useEditor((state) => state.edgeSelection)
  const nodes = useEditor((state) => state.doc.nodes)
  const files = useEditor((state) => state.files)
  if (!selection.length && !edges.length) return null
  const chosen = nodes.filter((node) => selection.includes(node.id))
  const feedable = chosen.some(
    (node) => node.image?.state === 'ready' || node.kind === 'text' || node.kind === 'group',
  )
  const groups = chosen.some((node) => node.kind === 'group')
  const single = chosen.length === 1 ? chosen[0] : undefined
  const file =
    single?.image?.state === 'ready' && single.image.file_id
      ? files[single.image.file_id]
      : undefined
  return (
    <div
      role="toolbar"
      aria-label={t('canvas.selection.toolbar')}
      className={cn(panel, 'flex max-w-[calc(100vw-32px)] items-center gap-0.5 overflow-x-auto')}
    >
      {selection.length ? (
        <span className="px-2 text-xs whitespace-nowrap text-muted-foreground">
          {t('canvas.selection.count', { count: selection.length })}
        </span>
      ) : null}
      {feedable ? (
        <button
          type="button"
          onClick={() => generateFromSelection(editor)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium whitespace-nowrap text-primary-foreground hover:bg-primary/90"
        >
          <Sparkles size={14} aria-hidden="true" />
          {t('canvas.selection.generate')}
        </button>
      ) : null}
      {file ? (
        <>
          <ToolButton label={t('canvas.selection.preview')} onClick={() => onPreview(file)}>
            <Eye size={16} />
          </ToolButton>
          <ToolButton label={t('canvas.selection.download')} onClick={() => onDownload(file)}>
            <Download size={16} />
          </ToolButton>
        </>
      ) : null}
      {chosen.some((node) => node.kind !== 'group') ? (
        <ToolButton
          label={t('canvas.selection.group')}
          onClick={() => groupSelection(editor, t('canvas.nodes.untitledGroup'))}
        >
          <Frame size={16} />
        </ToolButton>
      ) : null}
      {groups ? (
        <ToolButton label={t('canvas.selection.ungroup')} onClick={() => ungroupSelection(editor)}>
          <Ungroup size={16} />
        </ToolButton>
      ) : null}
      {selection.length ? (
        <>
          <ToolButton
            label={t('canvas.selection.duplicate')}
            onClick={() => duplicateSelection(editor)}
          >
            <Copy size={16} />
          </ToolButton>
          <ToolButton label={t('canvas.selection.front')} onClick={() => raiseSelection(editor)}>
            <ArrowUpToLine size={16} />
          </ToolButton>
        </>
      ) : null}
      <ToolButton
        label={t(selection.length ? 'canvas.selection.remove' : 'canvas.selection.removeEdge')}
        onClick={() => removeSelection(editor)}
      >
        <Trash2 size={16} />
      </ToolButton>
    </div>
  )
}
