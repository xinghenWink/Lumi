import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  drawEditorMarks,
  unit,
  type EditorMark,
  type EditorPoint,
} from '../../features/images/editor'
import type { ImageEditorDraft } from '../../features/images/editor-state'
import { cn } from '../../lib/utils'

type Gesture = { tool: NonNullable<ImageEditorDraft['tool']>; points: EditorPoint[] }

export function ImageEditorLayer({ draft }: { draft: ImageEditorDraft }) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<number | null>(null)
  const [gesture, setGesture] = useState<Gesture>()
  const [cursor, setCursor] = useState<EditorPoint>({ x: 0.5, y: 0.5 })
  const [keyboard, setKeyboard] = useState(false)
  const active = !!draft.tool && !draft.busy && !draft.submissionPending

  function mark(current: Gesture): EditorMark | undefined {
    if (current.tool !== draft.tool || !active) return
    const from = current.points[0],
      to = current.points.at(-1)
    if (!from || !to) return
    switch (current.tool) {
      case 'pen':
      case 'erase':
        return {
          kind: current.tool,
          points: current.points,
          color: current.tool === 'erase' ? '#ec4899' : draft.color,
          width: current.tool === 'erase' ? draft.brush / 100 : 0.006,
        }
      case 'rectangle':
      case 'ellipse':
        return { kind: current.tool, from, to, color: draft.color }
      default:
        return
    }
  }

  const preview = gesture && mark(gesture)
  useLayoutEffect(() => {
    const node = canvas.current
    const context = node?.getContext('2d')
    if (!node || !context) return
    const visibleMarks = draft.mode === 'markup' || draft.mode === 'erase' ? draft.marks : []
    const paint = () => {
      const { width, height } = node.getBoundingClientRect()
      const scale = Math.min(window.devicePixelRatio || 1, 2048 / Math.max(1, width, height))
      const w = Math.max(1, Math.round(width * scale)),
        h = Math.max(1, Math.round(height * scale))
      if (node.width !== w || node.height !== h) {
        node.width = w
        node.height = h
      }
      context.clearRect(0, 0, w, h)
      drawEditorMarks(context, w, h, preview ? [...visibleMarks, preview] : visibleMarks)
    }
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(node)
    return () => observer.disconnect()
  }, [draft.mode, draft.marks, preview])

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      x: unit((event.clientX - box.left) / box.width),
      y: unit((event.clientY - box.top) / box.height),
    }
  }

  function extend(current: Gesture, next: EditorPoint): Gesture {
    if (current.tool === 'rectangle' || current.tool === 'ellipse') {
      return { ...current, points: [...current.points.slice(0, 1), next] }
    }
    return current.points.length >= 2048
      ? current
      : { ...current, points: [...current.points, next] }
  }

  function begin(at: EditorPoint) {
    if (draft.tool === 'text' || draft.tool === 'comment') {
      draft.setNote({ kind: draft.tool, at })
    } else if (draft.tool) {
      setGesture({ tool: draft.tool, points: [at] })
    }
  }

  function finish(current: Gesture) {
    const result = mark(current)
    if (result) draft.add(result)
    setGesture(undefined)
  }

  function keyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!active) return
    if (event.key === 'Escape' && gesture) {
      event.preventDefault()
      event.stopPropagation()
      setGesture(undefined)
      return
    }
    const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
    const delta = Object.entries(arrows).find(([key]) => event.key === key)?.[1]
    if (delta) {
      event.preventDefault()
      event.stopPropagation()
      const step = event.shiftKey ? 0.1 : 0.01
      const next = {
        x: unit(cursor.x + (delta[0] ?? 0) * step),
        y: unit(cursor.y + (delta[1] ?? 0) * step),
      }
      setKeyboard(true)
      setCursor(next)
      if (gesture) setGesture(extend(gesture, next))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      setKeyboard(true)
      if (gesture) finish(gesture)
      else begin(cursor)
    }
  }

  return (
    <>
      <canvas
        ref={canvas}
        data-slot="image-editor-overlay"
        aria-label={active ? t('images.editor.canvasLabel') : undefined}
        aria-hidden={!active}
        tabIndex={active ? 0 : -1}
        className={cn(
          'absolute inset-0 size-full',
          active
            ? 'cursor-crosshair touch-none focus-visible:outline-2 focus-visible:outline-ring'
            : 'pointer-events-none',
        )}
        onFocus={(event) => setKeyboard(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => {
          setKeyboard(false)
          if (pointer.current === null) setGesture(undefined)
        }}
        onKeyDown={keyDown}
        onPointerDown={(event) => {
          if (!active || event.button !== 0 || pointer.current !== null) return
          const at = point(event)
          setKeyboard(false)
          setCursor(at)
          begin(at)
          if (draft.tool !== 'text' && draft.tool !== 'comment') {
            pointer.current = event.pointerId
            event.currentTarget.setPointerCapture(event.pointerId)
          }
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return
          const at = point(event)
          setGesture((current) => current && extend(current, at))
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return
          pointer.current = null
          if (gesture) finish(extend(gesture, point(event)))
        }}
        onLostPointerCapture={() => {
          pointer.current = null
          setGesture(undefined)
        }}
      />
      {active && keyboard ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-4 -translate-1/2 rounded-full border-2 border-white ring-1 ring-black"
          style={{ left: cursor.x * 100 + '%', top: cursor.y * 100 + '%' }}
        />
      ) : null}
    </>
  )
}
