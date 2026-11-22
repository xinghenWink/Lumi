import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Diamond,
  Eraser,
  Heart,
  LoaderCircle,
  Minus,
  MousePointer2,
  Palette,
  Pencil,
  Redo2,
  Shapes,
  Square,
  Star,
  Triangle,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../../api/transport'
import type { Point } from '../../../features/canvas/geometry'
import { emptyHistory, record, redo, undo } from '../../../features/canvas/history'
import {
  createSketchRenderer,
  eraseSketch,
  moveElement,
  sketchPoint,
  sketchShapes,
  sketchSize,
  type Sketch,
  type SketchElement,
  type SketchShape,
} from '../../features/sketch/drawing'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { ApiNotice } from './ApiNotice'

const tools = [
  { name: 'select', icon: MousePointer2 },
  { name: 'pen', icon: Pencil },
  { name: 'text', icon: Type },
  { name: 'eraser', icon: Eraser },
] as const

const shapeIcons = {
  line: Minus,
  arrow: ArrowUpRight,
  rectangle: Square,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
  star: Star,
  heart: Heart,
}

const palette = {
  black: '#171717',
  gray: '#6b7280',
  brown: '#925131',
  red: '#dc2626',
  orange: '#ea580c',
  yellow: '#eab308',
  green: '#16a34a',
  teal: '#0d9488',
  cyan: '#0891b2',
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#9333ea',
  pink: '#db2777',
}

type Tool = (typeof tools)[number]['name'] | 'shape'
type TextElement = Extract<SketchElement, { kind: 'text' }>
type Gesture =
  | ({ kind: 'pen'; id: number; color: string; points: Point[]; width: number } & Capture)
  | ({ kind: 'eraser'; points: Point[]; width: number } & Capture)
  | ({ kind: 'shape'; element: Extract<SketchElement, { kind: 'shape' }> } & Capture)
  | ({ kind: 'move'; id: number; start: Point; delta: Point } & Capture)

interface Capture {
  pointer: number
}

interface TextDraft {
  element: TextElement
  existing: boolean
}

const origin: Point = { x: 0, y: 0 }

function withGesture(sketch: Sketch, gesture: Gesture | null): Sketch {
  if (!gesture) return sketch
  if (gesture.kind === 'move') return moveElement(sketch, gesture.id, gesture.delta)
  if (gesture.kind === 'shape') return [...sketch, gesture.element]
  if (gesture.kind === 'pen') {
    const { id, color, points, width } = gesture
    return [...sketch, { id, kind: 'pen', color, points, width, offset: origin, erasures: [] }]
  }
  return sketch
}

function track(gesture: Gesture, point: Point) {
  if (gesture.kind === 'move') {
    gesture.delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }
  } else if (gesture.kind === 'shape') {
    gesture.element.end = point
  } else {
    const last = gesture.points.at(-1)
    if (!last || point.x !== last.x || point.y !== last.y) gesture.points.push(point)
  }
}

export default function SketchDialog({
  destination,
  maxBytes,
  returnFocus,
  onClose,
  onConfirm,
}: {
  destination: 'reference' | 'canvas'
  maxBytes: number
  returnFocus(): HTMLElement | null
  onClose(): void
  onConfirm(file: File): void | Promise<void>
}) {
  const { t } = useTranslation()
  const colorId = useId()
  const inkId = useId()
  const textId = useId()
  const shortcutsId = useId()
  const board = useRef<HTMLCanvasElement | null>(null)
  const textField = useRef<HTMLTextAreaElement>(null)
  const renderer = useRef<ReturnType<typeof createSketchRenderer>>(null)
  const sequence = useRef(0)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [ink, setInk] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [sketch, setSketch] = useState<Sketch>([])
  const [history, setHistory] = useState(() => emptyHistory<Sketch>())
  const [selected, setSelected] = useState<number | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [shape, setShape] = useState<SketchShape>('rectangle')
  const [color, setColor] = useState<string>(palette.black)
  const [width, setWidth] = useState(9)
  const [eraserWidth, setEraserWidth] = useState(35)
  const [textSize, setTextSize] = useState(48)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
  const [menuPortal, setMenuPortal] = useState<HTMLDivElement | null>(null)
  const editingText = !!textDraft

  const init = useCallback((node: HTMLCanvasElement | null) => {
    board.current = node
    renderer.current = node ? createSketchRenderer(node) : null
  }, [])

  useLayoutEffect(() => {
    const display = renderer.current
    if (!display) return
    display.paint(sketch)
    const choice = tool === 'select' && sketch.find((element) => element.id === selected)
    if (choice) display.highlight(choice)
  }, [sketch, selected, tool, discard])

  useEffect(() => {
    if (editingText) textField.current?.focus({ preventScroll: true })
  }, [editingText])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  function paintNextFrame() {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const display = renderer.current
      const active = gesture.current
      if (!display || !active) return
      const next = withGesture(sketch, active)
      display.paint(next, active.kind === 'eraser' ? active : undefined)
      if (active.kind === 'move') {
        const element = next.find((item) => item.id === active.id)
        if (element) display.highlight(element)
      }
    })
  }

  function show(next: Sketch) {
    const display = renderer.current
    if (display) {
      display.paint(next)
      setInk(display.hasInk())
      const choice = tool === 'select' && next.find((element) => element.id === selected)
      if (choice) display.highlight(choice)
    }
    setSketch(next)
    setError(null)
  }

  function commit(next: Sketch) {
    if (next !== sketch) setHistory(record(history, sketch))
    show(next)
  }

  function step(direction: 'undo' | 'redo') {
    if (gesture.current || saving.current) return
    const result = (direction === 'undo' ? undo : redo)(history, sketch)
    if (!result) return
    setHistory(result.history)
    show(result.value)
  }

  function choose(next: Tool) {
    if (gesture.current || textDraft) return
    setTool(next)
  }

  function startText(point: Point, existing?: TextElement) {
    setTextDraft({
      existing: !!existing,
      element: existing ?? {
        id: ++sequence.current,
        kind: 'text',
        at: {
          x: Math.min(point.x, sketchSize - textSize),
          y: Math.min(point.y, sketchSize - textSize),
        },
        text: '',
        color,
        size: textSize,
        offset: origin,
        erasures: [],
      },
    })
  }

  function finishText(save: boolean) {
    if (save && textDraft?.element.text.trim()) {
      const { element, existing } = textDraft
      commit(
        existing
          ? sketch.map((item) => (item.id === element.id ? element : item))
          : [...sketch, element],
      )
    }
    setTextDraft(null)
    board.current?.focus({ preventScroll: true })
  }

  function pointAt(event: PointerEvent<HTMLCanvasElement>) {
    return sketchPoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    )
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !event.isPrimary || gesture.current || saving.current || textDraft)
      return
    const canvas = event.currentTarget
    const point = pointAt(event)
    canvas.focus({ preventScroll: true })
    if (tool === 'text') {
      startText(point)
      return
    }
    const pointer = event.pointerId
    if (tool === 'select') {
      const element = renderer.current?.hit(sketch, point)
      setSelected(element?.id ?? null)
      if (!element) return
      gesture.current = { kind: 'move', pointer, id: element.id, start: point, delta: origin }
    } else if (tool === 'shape') {
      gesture.current = {
        kind: 'shape',
        pointer,
        element: {
          id: ++sequence.current,
          kind: 'shape',
          shape,
          start: point,
          end: point,
          width,
          color,
          offset: origin,
          erasures: [],
        },
      }
    } else if (tool === 'eraser') {
      gesture.current = { kind: 'eraser', pointer, points: [point], width: eraserWidth }
    } else {
      gesture.current = {
        kind: 'pen',
        pointer,
        points: [point],
        width,
        color,
        id: ++sequence.current,
      }
    }
    canvas.setPointerCapture(pointer)
    paintNextFrame()
  }

  function update(event: PointerEvent<HTMLCanvasElement>) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    track(active, pointAt(event))
    paintNextFrame()
  }

  function finish(event: PointerEvent<HTMLCanvasElement>, canceled = false) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    gesture.current = null
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    if (canceled) {
      show(sketch)
      return
    }
    track(active, pointAt(event))
    if (active.kind === 'shape') {
      const { start, end } = active.element
      if (start.x === end.x && start.y === end.y) {
        show(sketch)
        return
      }
    }
    const display = renderer.current
    commit(
      active.kind === 'eraser' && display
        ? eraseSketch(sketch, active, display.bounds)
        : withGesture(sketch, active),
    )
  }

  function keys(event: KeyboardEvent) {
    if (saving.current || gesture.current || discard || event.nativeEvent.isComposing) return
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, [contenteditable="true"], [role="menu"]')
    )
      return
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
      event.preventDefault()
      step(key === 'y' || event.shiftKey ? 'redo' : 'undo')
      return
    }
    if (event.target !== board.current || tool !== 'select') return
    const index = sketch.findIndex((element) => element.id === selected)
    if ((key === '[' || key === ']') && sketch.length) {
      event.preventDefault()
      const next =
        index < 0
          ? key === '['
            ? sketch.length - 1
            : 0
          : (index + sketch.length + (key === '[' ? -1 : 1)) % sketch.length
      setSelected(sketch[next]?.id ?? null)
      return
    }
    const element = sketch[index]
    if (!element) return
    const distance = event.shiftKey ? 24 : 6
    const shifts: Partial<Record<string, Point>> = {
      arrowleft: { x: -distance, y: 0 },
      arrowright: { x: distance, y: 0 },
      arrowup: { x: 0, y: -distance },
      arrowdown: { x: 0, y: distance },
    }
    const shift = shifts[key]
    if (shift) {
      event.preventDefault()
      commit(moveElement(sketch, element.id, shift))
    } else if (key === 'delete' || key === 'backspace') {
      event.preventDefault()
      commit(sketch.filter((item) => item.id !== element.id))
      setSelected(null)
    } else if (key === 'enter' && element.kind === 'text') {
      event.preventDefault()
      startText(element.at, element)
    }
  }

  function close() {
    if (saving.current) return
    const active = gesture.current
    if (active && board.current?.hasPointerCapture(active.pointer)) {
      board.current.releasePointerCapture(active.pointer)
    }
    if (discard || (!sketch.length && !history.past.length && !textDraft?.element.text.trim()))
      onClose()
    else setDiscard(true)
  }

  async function confirm() {
    if (!ink || textDraft || gesture.current || saving.current) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      const display = renderer.current
      display?.paint(sketch)
      const png = await display?.exportPNG()
      if (!board.current) return
      if (!png) throw new ApiError('SKETCH_EXPORT_FAILED')
      if (png.size > maxBytes) throw new ApiError('FILE_TOO_LARGE')
      await onConfirm(new File([png], t('images.sketch.filename'), { type: 'image/png' }))
      onClose()
    } catch (failure) {
      if (board.current) {
        setError(failure)
        const choice = tool === 'select' && sketch.find((element) => element.id === selected)
        if (choice) renderer.current?.highlight(choice)
      }
    } finally {
      saving.current = false
      if (board.current) setBusy(false)
    }
  }

  const size = tool === 'eraser' ? eraserWidth : tool === 'text' ? textSize : width
  const sizeLabel = t('images.sketch.' + (tool === 'text' ? 'fontSize' : 'width'))
  const controlsLocked = busy || editingText
  const selectedClass = 'bg-accent text-primary ring-1 ring-inset ring-primary/30'
  const ShapeIcon = shapeIcons[shape]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        data-lumi-modal
        className="top-1/2 left-1/2 max-h-[calc(100dvh-16px)] w-[calc(100%-16px)] max-w-2xl -translate-1/2 rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-xl sm:max-h-[calc(100dvh-32px)] sm:w-[calc(100%-32px)] sm:p-5"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          if (textDraft) finishText(false)
          else if (discard) {
            setDiscard(false)
            requestAnimationFrame(() => board.current?.focus({ preventScroll: true }))
          } else close()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus()?.focus({ preventScroll: true })
        }}
        onKeyDown={keys}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <DialogTitle className="text-base">{t('images.sketch.title')}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {t('images.sketch.description')}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.close')}
            disabled={busy}
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <p id={shortcutsId} className="sr-only">
          {t('images.sketch.shortcuts')}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-3">
          <div
            role="group"
            aria-label={t('images.sketch.tools')}
            className="grid grid-cols-7 items-center sm:flex sm:flex-col sm:items-start sm:gap-1"
          >
            {tools.map(({ name, icon: Icon }) => (
              <Button
                key={name}
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-11 w-full sm:w-11', tool === name && selectedClass)}
                aria-pressed={tool === name}
                aria-label={t('images.sketch.' + name)}
                title={t('images.sketch.' + name)}
                disabled={controlsLocked || discard}
                onClick={() => choose(name)}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn('h-11 w-full sm:w-11', tool === 'shape' && selectedClass)}
                  aria-label={t('images.sketch.shapes')}
                  title={t('images.sketch.shapes')}
                  disabled={controlsLocked || discard}
                >
                  {tool === 'shape' ? (
                    <ShapeIcon aria-hidden="true" />
                  ) : (
                    <Shapes aria-hidden="true" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                container={menuPortal}
                align="start"
                className="grid min-w-44 grid-cols-2"
              >
                <DropdownMenuGroup className="contents">
                  {sketchShapes.map((name) => {
                    const Icon = shapeIcons[name]
                    return (
                      <DropdownMenuItem
                        key={name}
                        onSelect={() => {
                          setShape(name)
                          choose('shape')
                        }}
                      >
                        <Icon aria-hidden="true" />
                        {t('images.sketch.' + name)}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="hidden h-px w-full bg-border sm:block" aria-hidden="true" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-full sm:w-11"
              aria-label={t('images.sketch.undo')}
              title={t('images.sketch.undo')}
              disabled={controlsLocked || discard || !history.past.length}
              onClick={() => step('undo')}
            >
              <Undo2 aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-full sm:w-11"
              aria-label={t('images.sketch.redo')}
              title={t('images.sketch.redo')}
              disabled={controlsLocked || discard || !history.future.length}
              onClick={() => step('redo')}
            >
              <Redo2 aria-hidden="true" />
            </Button>
          </div>
          <div className="relative grid min-w-0 place-items-center rounded-xl border border-border bg-muted/50 p-1.5 sm:p-2">
            <canvas
              ref={init}
              width={sketchSize}
              height={sketchSize}
              tabIndex={discard ? -1 : 0}
              aria-label={t('images.sketch.paper')}
              aria-describedby={shortcutsId}
              className={cn(
                'aspect-square w-full max-w-[min(100%,57dvh,31rem)] touch-none rounded-lg bg-white shadow-xs outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
                tool === 'select'
                  ? 'cursor-move'
                  : tool === 'text'
                    ? 'cursor-text'
                    : 'cursor-crosshair',
                (busy || discard || editingText) && 'pointer-events-none',
              )}
              onPointerDown={start}
              onPointerMove={update}
              onPointerUp={(event) => finish(event)}
              onPointerCancel={(event) => finish(event, true)}
              onLostPointerCapture={(event) => finish(event, true)}
              onDoubleClick={(event) => {
                if (tool !== 'select' || busy || discard) return
                const point = sketchPoint(
                  { x: event.clientX, y: event.clientY },
                  event.currentTarget.getBoundingClientRect(),
                )
                const element = renderer.current?.hit(sketch, point)
                if (element?.kind === 'text') startText(point, element)
              }}
            />
            {discard ? (
              <div className="absolute inset-0 grid place-items-center rounded-xl bg-overlay p-2">
                <div
                  role="group"
                  aria-label={t('images.sketch.discardTitle')}
                  className="w-full max-w-xs rounded-xl border border-border bg-card p-3 shadow-md sm:p-4"
                >
                  <p className="text-sm font-medium">{t('images.sketch.discardTitle')}</p>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      ref={(node) => node?.focus({ preventScroll: true })}
                      onClick={() => {
                        setDiscard(false)
                        requestAnimationFrame(() => board.current?.focus({ preventScroll: true }))
                      }}
                    >
                      {t('images.sketch.keepEditing')}
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={onClose}>
                      {t('images.sketch.discard')}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {textDraft ? (
          <form
            className="mt-3 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              finishText(true)
            }}
          >
            <label htmlFor={textId} className="text-xs font-medium">
              {t('images.sketch.text')}
            </label>
            <Textarea
              ref={textField}
              id={textId}
              maxLength={240}
              rows={2}
              value={textDraft.element.text}
              onChange={(event) =>
                setTextDraft({
                  ...textDraft,
                  element: { ...textDraft.element, text: event.target.value },
                })
              }
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => finishText(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={!textDraft.element.text.trim()}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        ) : null}
        {error ? (
          <div className="mt-3">
            <ApiNotice error={error} />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('images.sketch.palette')}
                  title={t('images.sketch.palette')}
                  disabled={controlsLocked || discard || tool === 'eraser'}
                >
                  <span
                    className="size-4 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent container={menuPortal} align="start" side="top">
                <DropdownMenuRadioGroup value={color} onValueChange={setColor}>
                  {Object.entries(palette).map(([name, value]) => (
                    <DropdownMenuRadioItem key={name} value={value}>
                      <span
                        className="size-3 rounded-full border border-border"
                        style={{ backgroundColor: value }}
                        aria-hidden="true"
                      />
                      {t('images.sketch.colors.' + name)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <label
              htmlFor={colorId}
              className="relative grid size-10 cursor-pointer place-items-center rounded-lg border border-input text-muted-foreground shadow-xs focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
              title={t('images.sketch.customColor')}
            >
              <Palette aria-hidden="true" className="size-4" />
              <Input
                id={colorId}
                type="color"
                aria-label={t('images.sketch.customColor')}
                value={color}
                disabled={controlsLocked || discard || tool === 'eraser'}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
            <label
              htmlFor={inkId}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              {sizeLabel}
              <Input
                id={inkId}
                type="range"
                className="h-9 w-20 cursor-pointer px-1 accent-primary sm:w-24"
                min={tool === 'text' ? 16 : 2}
                max={tool === 'text' ? 128 : tool === 'eraser' ? 128 : 48}
                value={size}
                disabled={controlsLocked || discard || tool === 'select'}
                onChange={(event) =>
                  (tool === 'text' ? setTextSize : tool === 'eraser' ? setEraserWidth : setWidth)(
                    Number(event.target.value),
                  )
                }
              />
              <output htmlFor={inkId} className="w-5 tabular-nums">
                {size}
              </output>
            </label>
          </div>
          <Button
            type="button"
            className="ml-auto"
            disabled={!ink || controlsLocked || discard}
            onClick={() => void confirm()}
          >
            {busy ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {t(busy ? 'common.loading' : 'images.sketch.' + destination)}
          </Button>
        </div>
        <div ref={setMenuPortal} />
      </DialogContent>
    </Dialog>
  )
}
