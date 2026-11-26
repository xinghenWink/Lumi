import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ImageOff, ImagePlus, Loader2, Sparkles, Wand2, X } from 'lucide-react'
import type { CanvasNode } from '../../../api/canvases'
import type { ImageFile } from '../../../api/images'
import { updateNode } from '../../../features/canvas/commands'
import { canGenerate, LIMITS } from '../../../features/canvas/document'
import { referenceAccept } from '../../features/files/reference-rules'
import type { Rect } from '../../../features/canvas/geometry'
import { useCanvas, useCanvasImage, useEditor } from '../../features/canvas/context'
import { openImageGeneration } from '../../features/canvas/actions'
import { cn } from '../../lib/utils'
import { CanvasVideoContent } from './CanvasVideoContent'

const stop = (event: { stopPropagation(): void }) => event.stopPropagation()

export interface NodeViewProps {
  node: CanvasNode
  rect: Rect
  selected: boolean
  zoom: number
}

/** Frame shared by every node kind: position, selection ring, resize handle and port. */
function Frame({
  node,
  rect,
  selected,
  zoom,
  children,
  className,
  port = true,
  inputPort = false,
}: NodeViewProps & {
  children: ReactNode
  className?: string
  port?: boolean
  inputPort?: boolean
}) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const handle = Math.max(10, 12 / zoom)
  const kind = t(node.kind === 'video' ? 'video.node' : 'canvas.nodes.' + node.kind)
  return (
    <div
      data-node-id={node.id}
      data-kind={node.kind}
      role="group"
      tabIndex={0}
      aria-label={t('canvas.nodes.label', { kind, title: node.title || summary(node) || kind })}
      data-selected={selected || undefined}
      className={cn(
        'canvas-node group/node absolute top-0 left-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-primary',
        className,
      )}
      style={{ transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.w, height: rect.h }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.target !== event.currentTarget) return
        event.preventDefault()
        editor.select([node.id])
        if (node.kind === 'text' && node.text?.state !== 'pending') editor.openInspector(node.id)
        if (node.kind === 'generator') editor.openInspector(node.id)
        if (node.kind === 'image') openImageGeneration(editor, node)
      }}
    >
      {children}
      {inputPort ? (
        <span
          aria-hidden="true"
          className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rounded-full border-2 border-card bg-primary"
        />
      ) : null}
      {port ? (
        <span
          data-handle="out"
          title={t('canvas.nodes.connect')}
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 grid -translate-y-1/2 cursor-crosshair place-items-center rounded-full border-2 border-card bg-muted-foreground transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100',
          )}
          style={{ right: -handle / 2 - 2, width: handle + 4, height: handle + 4 }}
        />
      ) : null}
      {selected ? (
        <span
          data-handle="resize"
          aria-hidden="true"
          title={t('canvas.nodes.resize')}
          className="absolute cursor-nwse-resize rounded-sm border-2 border-primary bg-card"
          style={{ right: -handle / 2, bottom: -handle / 2, width: handle, height: handle }}
        />
      ) : null}
    </div>
  )
}

function summary(node: CanvasNode) {
  if (node.text) return node.text.content.slice(0, 40)
  if (node.generator) return node.generator.prompt.slice(0, 40)
  return ''
}

function ImageContent({ node, zoom }: { node: CanvasNode; zoom: number }) {
  const { t, i18n } = useTranslation()
  const { editor, generation, uploads } = useCanvas()
  const picker = useRef<HTMLInputElement>(null)
  const image = node.image
  const file: ImageFile | undefined = useEditor((state) =>
    image?.file_id ? state.files[image.file_id] : undefined,
  )
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const wantsOriginal =
    !!file && node.w * zoom * ratio > Math.max(file.thumbnail_width, file.thumbnail_height) * 1.25
  const thumb = useCanvasImage(file, 'thumb')
  const original = useCanvasImage(wantsOriginal ? file : undefined, 'original')
  const url = original?.url ?? thumb?.url
  if (image?.state === 'pending')
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-muted/70 text-xs text-muted-foreground">
        <Loader2 size={20} className="animate-spin text-primary" aria-hidden="true" />
        <span>{t('canvas.nodes.pending')}</span>
        {image.task_id ? (
          <button
            type="button"
            onPointerDown={stop}
            onClick={() => {
              if (image.task_id) void generation.cancel(image.task_id)
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-card hover:text-foreground"
          >
            <X size={12} aria-hidden="true" />
            {t('canvas.nodes.cancelTask')}
          </button>
        ) : null}
      </div>
    )
  if (image?.state === 'empty' || image?.state === 'failed') {
    const key = 'errors.' + image.error_code
    const failed = image.state === 'failed'
    return (
      <div
        className={cn(
          'flex size-full flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center text-xs',
          failed
            ? 'border-destructive/30 bg-card text-destructive'
            : 'border-dashed border-input bg-card text-muted-foreground',
        )}
      >
        {failed ? (
          <AlertCircle size={20} aria-hidden="true" />
        ) : (
          <ImagePlus size={24} aria-hidden="true" />
        )}
        <span className="font-medium">
          {t(failed ? 'canvas.nodes.failed' : 'canvas.nodes.emptyImage')}
        </span>
        {image.error_code && i18n.exists(key) ? <span>{t(key)}</span> : null}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onPointerDown={stop}
            onClick={() => picker.current?.click()}
            className="min-h-8 rounded-md border border-border px-2.5 text-foreground hover:bg-muted"
          >
            {t('canvas.tools.upload')}
          </button>
          <button
            type="button"
            onPointerDown={stop}
            onClick={() => openImageGeneration(editor, node)}
            className="min-h-8 rounded-md bg-primary px-2.5 text-primary-foreground"
          >
            {t(failed ? 'canvas.generator.retry' : 'canvas.generator.edit')}
          </button>
        </div>
        <input
          ref={picker}
          type="file"
          hidden
          accept={referenceAccept}
          aria-label={t('canvas.tools.upload')}
          onChange={(event) => {
            uploads.place(Array.from(event.currentTarget.files ?? []), node, node.id)
            event.currentTarget.value = ''
          }}
        />
      </div>
    )
  }
  if (!file || thumb?.failed)
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-input bg-muted text-xs text-muted-foreground">
        <ImageOff size={18} aria-hidden="true" />
        {t('canvas.nodes.unavailable')}
      </div>
    )
  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      width={file.width}
      height={file.height}
      className="pointer-events-none size-full rounded-xl bg-muted object-cover select-none"
    />
  ) : (
    <div className="size-full animate-pulse rounded-xl bg-muted" />
  )
}

function TextContent({ node, editing }: { node: CanvasNode; editing: boolean }) {
  const { t, i18n } = useTranslation()
  const { editor, textRuns } = useCanvas()
  const content = node.text?.content ?? ''
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) field.current?.focus({ preventScroll: true })
  }, [editing])
  if (node.text?.state === 'pending') {
    const run = node.text.run_id
    return (
      <div
        className="grid size-full place-content-center gap-2 rounded-xl border border-dashed border-input bg-card text-center text-xs"
        role="status"
      >
        <Loader2 size={16} className="mx-auto animate-spin" />
        <span>{t('canvas.nodes.pending')}</span>
        {run ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 hover:bg-muted"
            onPointerDown={stop}
            onClick={() => void textRuns.cancel(run)}
          >
            {t('canvas.nodes.cancelTask')}
          </button>
        ) : null}
      </div>
    )
  }
  if (editing)
    return (
      <textarea
        ref={field}
        aria-label={t('canvas.nodes.editText')}
        defaultValue={content}
        maxLength={LIMITS.text}
        onPointerDown={stop}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur()
        }}
        onBlur={(event) => {
          const value = event.currentTarget.value
          editor.setEditing(null)
          if (value !== content)
            editor.apply((doc) =>
              updateNode(doc, node.id, (current) => ({ ...current, text: { content: value } })),
            )
        }}
        className="size-full resize-none rounded-xl border border-ring bg-card p-3 text-sm leading-6 outline-none"
      />
    )
  if (node.text?.state === 'failed') {
    const code = 'errors.' + node.text.error_code
    return (
      <div className="grid size-full place-content-center gap-2 rounded-xl border border-destructive/30 bg-card p-3 text-center text-xs">
        <strong className="font-medium text-destructive">{t('canvas.nodes.failed')}</strong>
        {i18n.exists(code) ? <span>{t(code)}</span> : null}
        <button
          type="button"
          className="rounded-md px-2 py-1 hover:bg-muted"
          onPointerDown={stop}
          onClick={() => {
            const source = editor.state.doc.edges.find(
              (edge) => edge.kind === 'result' && edge.to === node.id,
            )
            const previous = editor.state.doc.nodes.find((item) => item.id === source?.from)
            const target = previous?.kind === 'text' ? previous.id : node.id
            editor.select([target])
            editor.openInspector(target)
          }}
        >
          {t('canvas.generator.retry')}
        </button>
      </div>
    )
  }
  return (
    <div className="size-full overflow-hidden rounded-xl border border-border bg-card p-3 text-sm leading-6 whitespace-pre-wrap shadow-xs">
      {content || (
        <span className="text-muted-foreground">{t('canvas.nodes.textPlaceholder')}</span>
      )}
    </div>
  )
}

function GeneratorContent({ node }: { node: CanvasNode }) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const prompt = node.generator?.prompt ?? ''
  const inputs = useEditor((state) => state.doc.edges.filter((edge) => edge.to === node.id).length)
  return (
    <div className="flex size-full flex-col gap-2 rounded-xl border border-primary/30 bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-primary">
        <Sparkles size={14} aria-hidden="true" />
        {t('canvas.generator.heading')}
        {inputs ? (
          <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[11px] text-foreground">
            {inputs}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-5 min-h-0 flex-1 overflow-hidden text-sm leading-6 whitespace-pre-wrap">
        {prompt || <span className="text-muted-foreground">{t('canvas.generator.empty')}</span>}
      </p>
      <button
        type="button"
        onPointerDown={stop}
        onClick={() => {
          editor.select([node.id])
          editor.openInspector(node.id)
        }}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Wand2 size={13} aria-hidden="true" />
        {t('canvas.generator.edit')}
      </button>
    </div>
  )
}

function GroupTitle({ node }: { node: CanvasNode }) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const [editing, setEditing] = useState(false)
  if (editing)
    return (
      <input
        autoFocus
        aria-label={t('canvas.nodes.groupTitle')}
        defaultValue={node.title}
        maxLength={LIMITS.title}
        onPointerDown={stop}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
        }}
        onBlur={(event) => {
          const title = event.currentTarget.value.trim()
          setEditing(false)
          if (title !== node.title)
            editor.apply((doc) => updateNode(doc, node.id, (current) => ({ ...current, title })))
        }}
        className="h-7 w-48 rounded-md border border-ring bg-card px-2 text-xs outline-none"
      />
    )
  return (
    <button
      type="button"
      onPointerDown={stop}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === 'F2') setEditing(true)
      }}
      className="max-w-full truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground"
    >
      {node.title || t('canvas.nodes.untitledGroup')}
    </button>
  )
}

export const CanvasNodeView = memo(function CanvasNodeView(
  props: NodeViewProps & { editing: boolean },
) {
  const { node, editing } = props
  if (node.kind === 'video')
    return (
      <Frame {...props} port={node.video?.state === 'ready'} inputPort>
        <CanvasVideoContent node={node} />
      </Frame>
    )
  if (node.kind === 'group')
    return (
      <Frame {...props} className="rounded-2xl border-2 border-dashed border-input bg-muted/30">
        <div className="flex h-9 items-center px-2">
          <GroupTitle node={node} />
        </div>
      </Frame>
    )
  if (node.kind === 'text')
    return (
      <Frame {...props} inputPort>
        <TextContent node={node} editing={editing} />
      </Frame>
    )
  if (node.kind === 'generator')
    return (
      <Frame {...props} port={false} inputPort>
        <GeneratorContent node={node} />
      </Frame>
    )
  return (
    <Frame {...props} port={node.image?.state === 'ready'} inputPort={canGenerate(node)}>
      <ImageContent node={node} zoom={props.zoom} />
    </Frame>
  )
})
