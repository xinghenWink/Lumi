import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { CanvasNode, CanvasViewport as Viewport } from '../../../api/canvases'
import { images } from '../../../api/images'
import {
  aspectResize,
  canConnect,
  connect,
  moveNodes,
  reparent,
  resizeNode,
  withMembers,
} from '../../../features/canvas/commands'
import { clampSize } from '../../../features/canvas/document'
import { decodeFragment, encodeFragment } from '../../../features/canvas/clipboard'
import {
  distance,
  intersects,
  midpoint,
  normalizeRect,
  outputPort,
  screenToWorld,
  visibleRect,
  zoomAt,
  type Point,
  type Rect,
} from '../../../features/canvas/geometry'
import { useCanvas, useEditor } from '../../features/canvas/context'
import {
  addGenerator,
  addText,
  copySelection,
  createAt,
  duplicateSelection,
  fitAll,
  groupSelection,
  nudgeSelection,
  openImageGeneration,
  pasteFragment,
  removeSelection,
  resetZoom,
  selectAll,
  ungroupSelection,
  wheel,
  zoomBy,
} from '../../features/canvas/actions'
import { useFileDrop } from '../../features/files/drop'
import { useImageConfig } from '../../features/images/config'
import { CanvasEdges } from './CanvasEdges'
import { CanvasCreateMenu, type CreateMenuAnchor } from './CanvasCreateMenu'
import { CanvasNodeView } from './CanvasNodeView'
import { cn } from '../../lib/utils'

type Gesture =
  | { kind: 'pan'; pointer: number; start: Point; origin: Viewport }
  | {
      kind: 'move'
      pointer: number
      start: Point
      ids: ReadonlySet<string>
      node: string
      moved: boolean
      additive: boolean
    }
  | { kind: 'resize'; pointer: number; start: Point; node: CanvasNode; keep: boolean }
  | { kind: 'marquee'; pointer: number; start: Point; additive: boolean; moved: boolean }
  | { kind: 'connect'; pointer: number; from: string }
  | { kind: 'pinch'; distance: number; mid: Point; origin: Viewport }

const editable = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
const isEditable = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest(editable)
const modalOpen = () => !!document.querySelector('[data-lumi-modal]')
const DRAG_THRESHOLD = 3

export function CanvasViewport({
  menu,
  onMenu,
}: {
  menu: CreateMenuAnchor | null
  onMenu(menu: CreateMenuAnchor | null): void
}) {
  const { t } = useTranslation()
  const { editor, uploads } = useCanvas()
  const doc = useEditor((state) => state.doc)
  const viewport = useEditor((state) => state.viewport)
  const selection = useEditor((state) => state.selection)
  const edgeSelection = useEditor((state) => state.edgeSelection)
  const preview = useEditor((state) => state.preview)
  const placeholders = useEditor((state) => state.placeholders)
  const editing = useEditor((state) => state.editing)
  const tool = useEditor((state) => state.tool)
  const stage = useEditor((state) => state.stage)
  const element = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const frame = useRef(0)
  const latest = useRef<{ point: Point; pointer: number; shift: boolean } | null>(null)
  const space = useRef(false)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [draft, setDraft] = useState<{ from: Point; to: Point } | null>(null)
  const [panning, setPanning] = useState(false)

  const local = (event: { clientX: number; clientY: number }): Point => {
    const bounds = element.current?.getBoundingClientRect()
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
  }

  const maxBytes = useImageConfig().data?.max_upload_bytes ?? 10 * 1_048_576
  useFileDrop({
    enabled: true,
    title: t('canvas.upload.title'),
    hint: t('canvas.upload.hint', { size: (maxBytes / 1_048_576).toLocaleString() }),
    onFiles(files, point) {
      const state = editor.state
      const at = point
        ? screenToWorld(local({ clientX: point.x, clientY: point.y }), state.viewport)
        : screenToWorld({ x: state.stage.width / 2, y: state.stage.height / 2 }, state.viewport)
      uploads.place(files, at)
    },
  })

  // The stage size drives centering, fitting and culling.
  useEffect(() => {
    const node = element.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        editor.setStage({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [editor])

  // Wheel zoom needs a non-passive listener so the page and browser zoom stay still.
  useEffect(() => {
    const node = element.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (isEditable(event.target)) return
      event.preventDefault()
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const state = editor.state.viewport
        editor.setViewport({ ...state, x: state.x - event.deltaY * scale })
        return
      }
      wheel(editor, local(event), event.deltaY * scale)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [editor])

  // Keyboard shortcuts apply while no field or dialog has focus.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditable(event.target) || modalOpen()) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const state = editor.state
      // Space keeps activating focused buttons and links instead of starting a pan.
      const control = event.target instanceof Element ? event.target : null
      if (key === ' ' && control?.closest('button, a, [role="menuitem"]')) return
      let handled = true
      if (key === ' ') {
        space.current = true
        setPanning(true)
      } else if (mod && key === 'z') {
        if (event.shiftKey) editor.redo()
        else editor.undo()
      } else if (mod && key === 'y') editor.redo()
      else if (mod && key === 'a') selectAll(editor)
      else if (mod && key === 'd') duplicateSelection(editor)
      else if (mod && key === 'g') {
        if (event.shiftKey) ungroupSelection(editor)
        else groupSelection(editor, t('canvas.nodes.untitledGroup'))
      } else if (mod) handled = false
      else if (key === 'delete' || key === 'backspace') removeSelection(editor)
      else if (key === 'escape') {
        editor.select([])
        editor.openInspector(null)
      } else if (key === 'v') editor.setTool('select')
      else if (key === 'h') editor.setTool('hand')
      else if (key === 't') addText(editor)
      else if (key === 'g') addGenerator(editor)
      else if (key === '0') resetZoom(editor)
      else if (key === '1') fitAll(editor)
      else if (key === '=' || key === '+') zoomBy(editor, 1.2)
      else if (key === '-') zoomBy(editor, 1 / 1.2)
      else if (key.startsWith('arrow') && state.selection.length) {
        const step = event.shiftKey ? 10 : 1
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
        nudgeSelection(editor, dx, dy)
      } else handled = false
      if (handled) event.preventDefault()
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        space.current = false
        setPanning(false)
      }
    }
    const copy = (event: ClipboardEvent) => {
      if (isEditable(event.target) || modalOpen() || !event.clipboardData) return
      const fragment = copySelection(editor)
      if (!fragment) return
      event.clipboardData.setData('text/plain', encodeFragment(fragment))
      event.preventDefault()
    }
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isEditable(event.target) || modalOpen()) return
      const fragment = decodeFragment(event.clipboardData?.getData('text/plain') ?? '')
      if (!fragment) return
      event.preventDefault()
      // Files from another canvas or account must still be readable by this viewer.
      const known = editor.state.files
      const unknown = [
        ...new Set(
          fragment.nodes.flatMap((node) =>
            node.image?.file_id && !known[node.image.file_id] ? [node.image.file_id] : [],
          ),
        ),
      ]
      void Promise.allSettled(unknown.map((id) => images.file(id))).then((results) => {
        const readable = new Set(Object.keys(editor.state.files))
        const found = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )
        editor.addFiles(found)
        for (const file of found) readable.add(file.id)
        const nodes = fragment.nodes.filter(
          (node) => !node.image?.file_id || readable.has(node.image.file_id),
        )
        const kept = new Set(nodes.map((node) => node.id))
        pasteFragment(editor, {
          nodes,
          edges: fragment.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
        })
      })
    }
    const blur = () => {
      space.current = false
      setPanning(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('copy', copy)
    document.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('copy', copy)
      document.removeEventListener('paste', paste)
    }
  }, [editor, t])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  function startPinch() {
    const [a, b] = [...pointers.current.values()]
    if (!a || !b) return
    editor.setPreview(null)
    setMarquee(null)
    setDraft(null)
    gesture.current = {
      kind: 'pinch',
      distance: Math.max(distance(a, b), 1),
      mid: midpoint(a, b),
      origin: editor.state.viewport,
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button > 1 || isEditable(event.target)) return
    if (menu) onMenu(null)
    const point = local(event)
    pointers.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size === 2) {
      startPinch()
      return
    }
    if (pointers.current.size > 2) return
    const state = editor.state
    const world = screenToWorld(point, state.viewport)
    const target = event.target instanceof Element ? event.target : null
    const handle = target?.closest('[data-handle]')?.getAttribute('data-handle')
    const nodeId = target?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
    const edgeId = target?.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? null
    const mod = event.ctrlKey || event.metaKey
    const background = !nodeId && !edgeId
    const select =
      event.pointerType === 'touch' ? state.tool === 'select' : mod || state.tool === 'select'
    if (event.button === 1 || space.current || (background && !select)) {
      gesture.current = {
        kind: 'pan',
        pointer: event.pointerId,
        start: point,
        origin: state.viewport,
      }
      setPanning(true)
      return
    }
    if (nodeId && handle === 'out') {
      gesture.current = { kind: 'connect', pointer: event.pointerId, from: nodeId }
      return
    }
    const node = nodeId ? state.doc.nodes.find((item) => item.id === nodeId) : undefined
    if (node && handle === 'resize') {
      gesture.current = {
        kind: 'resize',
        pointer: event.pointerId,
        start: world,
        node,
        keep: node.kind === 'image',
      }
      return
    }
    if (node) {
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const selected = state.selection.includes(node.id)
      if (additive) editor.select([node.id], 'toggle')
      else if (!selected) editor.select([node.id])
      const ids = editor.state.selection.includes(node.id) ? editor.state.selection : [node.id]
      gesture.current = {
        kind: 'move',
        pointer: event.pointerId,
        start: world,
        ids: withMembers(state.doc, ids),
        node: node.id,
        moved: false,
        additive,
      }
      return
    }
    if (edgeId) {
      editor.selectEdge(edgeId)
      return
    }
    gesture.current = {
      kind: 'marquee',
      pointer: event.pointerId,
      start: world,
      additive: event.shiftKey,
      moved: false,
    }
  }

  function track(point: Point, pointer: number, shift: boolean) {
    const current = gesture.current
    if (!current) return
    const state = editor.state
    if (current.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b) return
      const mid = midpoint(a, b)
      const shifted = {
        ...current.origin,
        x: current.origin.x + mid.x - current.mid.x,
        y: current.origin.y + mid.y - current.mid.y,
      }
      editor.setViewport(
        zoomAt(shifted, mid, (current.origin.zoom * distance(a, b)) / current.distance),
      )
      return
    }
    if (current.pointer !== pointer) return
    const world = screenToWorld(point, state.viewport)
    if (current.kind === 'pan') {
      editor.setViewport({
        ...current.origin,
        x: current.origin.x + point.x - current.start.x,
        y: current.origin.y + point.y - current.start.y,
      })
    } else if (current.kind === 'move') {
      const dx = world.x - current.start.x,
        dy = world.y - current.start.y
      if (!current.moved && Math.hypot(dx, dy) * state.viewport.zoom < DRAG_THRESHOLD) return
      current.moved = true
      editor.setPreview({ kind: 'move', ids: current.ids, dx, dy })
    } else if (current.kind === 'resize') {
      const { node } = current
      const w = clampSize(node.w + world.x - current.start.x),
        h = clampSize(node.h + world.y - current.start.y)
      const rect = current.keep && !shift ? aspectResize(node, w, h) : { ...node, w, h }
      editor.setPreview({ kind: 'resize', id: node.id, rect })
    } else if (current.kind === 'marquee') {
      const rect = normalizeRect(current.start, world)
      if (!current.moved && Math.max(rect.w, rect.h) * state.viewport.zoom < DRAG_THRESHOLD) return
      current.moved = true
      setMarquee(rect)
    } else {
      const from = state.doc.nodes.find((node) => node.id === current.from)
      if (from) setDraft({ from: outputPort(from), to: world })
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    const point = local(event),
      pointer = event.pointerId,
      shift = event.shiftKey
    pointers.current.set(pointer, point)
    cancelAnimationFrame(frame.current)
    latest.current = { point, pointer, shift }
    frame.current = requestAnimationFrame(() => {
      latest.current = null
      track(point, pointer, shift)
    })
  }

  /** Applies a move still waiting for its animation frame, so a release keeps it. */
  function settle() {
    cancelAnimationFrame(frame.current)
    const pending = latest.current
    latest.current = null
    if (pending) track(pending.point, pending.pointer, pending.shift)
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current
    if (current?.kind === 'pinch' && !cancelled) {
      pointers.current.set(event.pointerId, local(event))
      track(local(event), event.pointerId, event.shiftKey)
    }
    if (!cancelled) settle()
    else cancelAnimationFrame(frame.current)
    latest.current = null
    pointers.current.delete(event.pointerId)
    if (!current) return
    if (current.kind === 'pinch') {
      // Lifting one finger ends the pinch; the remaining finger does nothing until lifted.
      if (pointers.current.size < 2) gesture.current = null
      return
    }
    if (current.pointer !== event.pointerId) return
    gesture.current = null
    setPanning(space.current)
    const state = editor.state
    const world = screenToWorld(local(event), state.viewport)
    if (current.kind === 'move') {
      const preview = state.preview
      editor.setPreview(null)
      if (cancelled) return
      if (current.moved && preview?.kind === 'move') {
        editor.apply((doc) =>
          reparent(moveNodes(doc, current.ids, preview.dx, preview.dy), current.ids),
        )
      } else if (!current.moved && !current.additive) editor.select([current.node])
    } else if (current.kind === 'resize') {
      const preview = state.preview
      editor.setPreview(null)
      if (!cancelled && preview?.kind === 'resize')
        editor.apply((doc) => resizeNode(doc, preview.id, preview.rect))
    } else if (current.kind === 'marquee') {
      setMarquee(null)
      if (cancelled) return
      if (!current.moved) {
        if (!current.additive) editor.select([])
        editor.openInspector(null)
        return
      }
      const area = normalizeRect(current.start, world)
      const hits = state.doc.nodes
        .filter(
          (node) => intersects(node, area) && (node.kind !== 'group' || contained(node, area)),
        )
        .map((node) => node.id)
      editor.select(hits, current.additive ? 'add' : 'replace')
    } else if (current.kind === 'connect') {
      setDraft(null)
      if (cancelled) return
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      const target = hit?.closest('[data-node-id]')?.getAttribute('data-node-id')
      if (target && canConnect(state.doc, current.from, target))
        editor.apply((doc) => connect(doc, current.from, target))
      else if (!target && hit?.closest('[data-testid="canvas-viewport"]'))
        onMenu({ point: local(event), source: current.from })
    } else if (
      current.kind === 'pan' &&
      !cancelled &&
      distance(current.start, local(event)) < DRAG_THRESHOLD
    ) {
      editor.select([])
      editor.openInspector(null)
    }
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    // Pointer capture can retarget the click to the viewport even when it started on a node.
    const target =
      event.target === event.currentTarget
        ? document.elementFromPoint(event.clientX, event.clientY)
        : event.target instanceof Element
          ? event.target
          : null
    const nodeId = target?.closest('[data-node-id]')?.getAttribute('data-node-id')
    const state = editor.state
    if (nodeId) {
      const node = state.doc.nodes.find((item) => item.id === nodeId)
      if (node?.kind === 'text' && node.text?.state !== 'pending') editor.setEditing(node.id)
      if (node?.kind === 'generator') editor.openInspector(node.id)
      if (node?.kind === 'image') openImageGeneration(editor, node)
      return
    }
    if (target?.closest('[data-edge-id]')) return
    onMenu({ point: local(event) })
  }

  // Previewed geometry replaces stored geometry while a drag is in progress.
  const rects = useMemo(() => {
    const map = new Map<string, Rect>()
    for (const node of doc.nodes) {
      if (preview?.kind === 'move' && preview.ids.has(node.id))
        map.set(node.id, { x: node.x + preview.dx, y: node.y + preview.dy, w: node.w, h: node.h })
      else if (preview?.kind === 'resize' && preview.id === node.id) map.set(node.id, preview.rect)
      else map.set(node.id, node)
    }
    return map
  }, [doc.nodes, preview])

  const visible = useMemo(() => {
    if (!stage.width || !stage.height) return []
    const area = visibleRect(viewport, stage, Math.max(stage.width, stage.height))
    const chosen = new Set(selection)
    const shown = doc.nodes.filter((node) => {
      const rect = rects.get(node.id) ?? node
      return chosen.has(node.id) || intersects(rect, area)
    })
    return [
      ...shown.filter((node) => node.kind === 'group'),
      ...shown.filter((node) => node.kind !== 'group'),
    ]
  }, [doc.nodes, rects, viewport, stage, selection])

  const chosen = new Set(selection)
  const grid = 24 * viewport.zoom
  return (
    <div
      ref={element}
      role="application"
      aria-roledescription={t('canvas.editor.roleDescription')}
      aria-label={t('canvas.editor.region')}
      data-testid="canvas-viewport"
      className={cn(
        // Clip rather than hide: focusing a node near the edge must never scroll the stage.
        'canvas-viewport relative size-full touch-none overflow-clip bg-background outline-none select-none',
        panning || tool === 'hand' ? 'cursor-grab' : 'cursor-default',
      )}
      style={
        grid >= 8
          ? {
              backgroundImage:
                'linear-gradient(to right, color-mix(in srgb, var(--input) 35%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--input) 35%, transparent) 1px, transparent 1px)',
              backgroundSize: `${grid}px ${grid}px`,
              backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            }
          : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => {
        if (pointers.current.has(event.pointerId)) finish(event, true)
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {visible
          .filter((node) => node.kind === 'group')
          .map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              rect={rects.get(node.id) ?? node}
              selected={chosen.has(node.id)}
              zoom={viewport.zoom}
              editing={false}
            />
          ))}
        <CanvasEdges
          edges={doc.edges}
          rects={rects}
          selected={edgeSelection}
          selectedNodes={selection}
          zoom={viewport.zoom}
          draft={draft}
        />
        {visible
          .filter((node) => node.kind !== 'group')
          .map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              rect={rects.get(node.id) ?? node}
              selected={chosen.has(node.id)}
              zoom={viewport.zoom}
              editing={editing === node.id}
            />
          ))}
        {placeholders.map((item) => (
          <div
            key={item.id}
            role="status"
            aria-label={t('canvas.nodes.uploading')}
            className="pointer-events-none absolute top-0 left-0 grid place-items-center overflow-hidden rounded-xl border border-dashed border-input bg-muted/80"
            style={{
              transform: `translate(${item.rect.x}px, ${item.rect.y}px)`,
              width: item.rect.w,
              height: item.rect.h,
            }}
          >
            {item.preview ? (
              <img
                src={item.preview}
                alt=""
                className="absolute inset-0 size-full object-cover opacity-50"
              />
            ) : null}
            <Loader2 size={22} className="relative animate-spin text-primary" aria-hidden="true" />
          </div>
        ))}
      </div>
      {marquee ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 rounded-sm border border-primary bg-primary/10"
          style={{
            transform: `translate(${marquee.x * viewport.zoom + viewport.x}px, ${marquee.y * viewport.zoom + viewport.y}px)`,
            width: marquee.w * viewport.zoom,
            height: marquee.h * viewport.zoom,
          }}
        />
      ) : null}
      {!doc.nodes.length && !placeholders.length ? (
        <p className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
          {t('canvas.editor.empty')}
        </p>
      ) : null}
      {menu ? (
        <CanvasCreateMenu
          anchor={menu}
          width={stage.width}
          height={stage.height}
          onDismiss={() => onMenu(null)}
          onChoose={(kind) => {
            createAt(editor, kind, screenToWorld(menu.point, editor.state.viewport), menu.source)
            onMenu(null)
          }}
        />
      ) : null}
    </div>
  )
}

function contained(inner: Rect, outer: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}
