import {
  contains,
  intersects,
  normalizeRect,
  type Point,
  type Rect,
} from '../../../features/canvas/geometry'

export const sketchSize = 1024

export const sketchShapes = [
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'heart',
] as const

export type SketchShape = (typeof sketchShapes)[number]

export interface BrushStroke {
  points: readonly Point[]
  width: number
}

interface ElementStyle {
  id: number
  color: string
  offset: Point
  erasures: readonly { stroke: BrushStroke; origin: Point }[]
}

export type SketchElement = ElementStyle &
  (
    | ({ kind: 'pen' } & BrushStroke)
    | { kind: 'shape'; shape: SketchShape; start: Point; end: Point; width: number }
    | { kind: 'text'; at: Point; text: string; size: number }
  )

export type Sketch = readonly SketchElement[]

type Path = Pick<
  CanvasRenderingContext2D,
  'moveTo' | 'lineTo' | 'rect' | 'ellipse' | 'bezierCurveTo' | 'closePath'
>

export function sketchPoint(point: Point, box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {
  const scale = (delta: number, length: number) =>
    Math.max(0, Math.min(sketchSize, (delta / (length || 1)) * sketchSize))
  return { x: scale(point.x - box.left, box.width), y: scale(point.y - box.top, box.height) }
}

function polygon(path: Path, points: readonly Point[]) {
  const [first, ...rest] = points
  if (!first) return
  path.moveTo(first.x, first.y)
  for (const point of rest) path.lineTo(point.x, point.y)
  path.closePath()
}

export function traceShape(
  path: Path,
  shape: SketchShape,
  start: Point,
  end: Point,
  width: number,
) {
  const { x, y, w, h } = normalizeRect(start, end)
  const center = { x: x + w / 2, y: y + h / 2 }
  switch (shape) {
    case 'line':
    case 'arrow': {
      path.moveTo(start.x, start.y)
      path.lineTo(end.x, end.y)
      if (shape === 'arrow') {
        const dx = end.x - start.x
        const dy = end.y - start.y
        const turn = Math.atan2(dy, dx)
        const length = Math.min(Math.hypot(dx, dy) * 0.45, Math.max(24, width * 3))
        for (const angle of [turn - Math.PI / 6, turn + Math.PI / 6]) {
          path.moveTo(end.x, end.y)
          path.lineTo(end.x - length * Math.cos(angle), end.y - length * Math.sin(angle))
        }
      }
      return
    }
    case 'rectangle':
      path.rect(x, y, w, h)
      return
    case 'ellipse':
      path.ellipse(center.x, center.y, w / 2, h / 2, 0, 0, Math.PI * 2)
      return
    case 'triangle':
      polygon(path, [
        { x: center.x, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ])
      return
    case 'diamond':
      polygon(path, [
        { x: center.x, y },
        { x: x + w, y: center.y },
        { x: center.x, y: y + h },
        { x, y: center.y },
      ])
      return
    case 'star':
      polygon(
        path,
        Array.from({ length: 10 }, (_, index) => {
          const angle = (index * Math.PI) / 5 - Math.PI / 2
          const radius = index % 2 === 0 ? 0.5 : 0.21
          return {
            x: center.x + Math.cos(angle) * w * radius,
            y: center.y + Math.sin(angle) * h * radius,
          }
        }),
      )
      return
    case 'heart':
      path.moveTo(center.x, y + h)
      path.bezierCurveTo(x + w * 0.4, y + h * 0.85, x, y + h * 0.62, x, y + h * 0.28)
      path.bezierCurveTo(x, y + h * 0.03, x + w * 0.28, y - h * 0.08, center.x, y + h * 0.18)
      path.bezierCurveTo(x + w * 0.72, y - h * 0.08, x + w, y + h * 0.03, x + w, y + h * 0.28)
      path.bezierCurveTo(x + w, y + h * 0.62, x + w * 0.6, y + h * 0.85, center.x, y + h)
      path.closePath()
  }
}

function strokeBounds({ points, width }: BrushStroke): Rect {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const point of points) {
    left = Math.min(left, point.x)
    top = Math.min(top, point.y)
    right = Math.max(right, point.x)
    bottom = Math.max(bottom, point.y)
  }
  return {
    x: left - width / 2,
    y: top - width / 2,
    w: right - left + width,
    h: bottom - top + width,
  }
}

export function moveElement(sketch: Sketch, id: number, delta: Point): Sketch {
  if ((!delta.x && !delta.y) || !sketch.some((element) => element.id === id)) return sketch
  return sketch.map((element) =>
    element.id === id
      ? { ...element, offset: { x: element.offset.x + delta.x, y: element.offset.y + delta.y } }
      : element,
  )
}

export function eraseSketch(
  sketch: Sketch,
  stroke: BrushStroke,
  bounds: (element: SketchElement) => Rect,
): Sketch {
  if (!stroke.points.length) return sketch
  const area = strokeBounds(stroke)
  let changed = false
  const next = sketch.map((element) => {
    if (!intersects(area, bounds(element))) return element
    changed = true
    // Save masks in the element's local space so an erased spot moves with that element.
    return { ...element, erasures: [...element.erasures, { stroke, origin: element.offset }] }
  })
  return changed ? next : sketch
}

export function hasVisibleInk(pixels: Uint8ClampedArray) {
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      pixels[index + 3] &&
      (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255)
    )
      return true
  }
  return false
}

const textFont = (size: number) => String(size) + 'px system-ui, sans-serif'
const lineHeight = (size: number) => size * 1.25

function drawStroke(context: CanvasRenderingContext2D, { points, width }: BrushStroke) {
  const [start] = points
  if (!start) return
  context.beginPath()
  if (points.length === 1) {
    context.arc(start.x, start.y, width / 2, 0, Math.PI * 2)
    context.fill()
    return
  }
  context.lineWidth = width
  context.lineJoin = 'round'
  context.lineCap = 'round'
  context.moveTo(start.x, start.y)
  for (let index = 1; index < points.length; index++) {
    const point = points[index]
    if (point) context.lineTo(point.x, point.y)
  }
  context.stroke()
}

function drawElement(context: CanvasRenderingContext2D, element: SketchElement) {
  context.save()
  context.translate(element.offset.x, element.offset.y)
  context.fillStyle = context.strokeStyle = element.color
  if (element.kind === 'pen') drawStroke(context, element)
  if (element.kind === 'shape') {
    context.beginPath()
    context.lineWidth = element.width
    context.lineJoin = 'round'
    context.lineCap = 'round'
    traceShape(context, element.shape, element.start, element.end, element.width)
    context.stroke()
  }
  if (element.kind === 'text') {
    context.font = textFont(element.size)
    context.textBaseline = 'top'
    element.text
      .split('\n')
      .forEach((line, index) =>
        context.fillText(line, element.at.x, element.at.y + index * lineHeight(element.size)),
      )
  }
  if (element.erasures.length) {
    context.globalCompositeOperation = 'destination-out'
    for (const { stroke, origin } of element.erasures) {
      context.save()
      context.translate(-origin.x, -origin.y)
      drawStroke(context, stroke)
      context.restore()
    }
  }
  context.restore()
}

export function createSketchRenderer(canvas: HTMLCanvasElement) {
  const layer = document.createElement('canvas')
  layer.width = layer.height = sketchSize
  const displayContext = canvas.getContext('2d', { willReadFrequently: true })
  const layerContext = layer.getContext('2d', { willReadFrequently: true })
  if (!displayContext || !layerContext) return null
  const context = displayContext
  const scratch = layerContext

  function bounds(element: SketchElement): Rect {
    let box: Rect
    if (element.kind === 'text') {
      const lines = element.text.split('\n')
      scratch.font = textFont(element.size)
      box = {
        x: element.at.x,
        y: element.at.y,
        w: Math.max(...lines.map((line) => scratch.measureText(line).width)),
        h: lines.length * lineHeight(element.size),
      }
    } else if (element.kind === 'pen') {
      box = strokeBounds(element)
    } else {
      const padding = element.shape === 'arrow' ? Math.max(24, element.width * 3) : element.width
      const { x, y, w, h } = normalizeRect(element.start, element.end)
      box = { x: x - padding, y: y - padding, w: w + padding * 2, h: h + padding * 2 }
    }
    return { ...box, x: box.x + element.offset.x, y: box.y + element.offset.y }
  }

  function clear(target: CanvasRenderingContext2D) {
    target.clearRect(0, 0, sketchSize, sketchSize)
  }

  function paint(sketch: Sketch, eraser?: BrushStroke) {
    clear(context)
    for (const element of sketch) {
      if (element.erasures.length) {
        clear(scratch)
        drawElement(scratch, element)
        context.drawImage(layer, 0, 0)
      } else drawElement(context, element)
    }
    if (eraser) {
      context.save()
      context.globalCompositeOperation = 'destination-out'
      drawStroke(context, eraser)
      context.restore()
    }
  }

  return {
    bounds,
    paint,
    highlight(element: SketchElement) {
      const { x, y, w, h } = bounds(element)
      context.save()
      context.strokeStyle = '#2563eb'
      context.lineWidth = 3
      context.setLineDash([8, 6])
      context.strokeRect(x - 6, y - 6, w + 12, h + 12)
      context.restore()
    },
    hit(sketch: Sketch, point: Point) {
      const radius = 9
      for (let index = sketch.length - 1; index >= 0; index--) {
        const element = sketch[index]
        if (!element) continue
        const { x, y, w, h } = bounds(element)
        if (
          !contains({ x: x - radius, y: y - radius, w: w + radius * 2, h: h + radius * 2 }, point)
        )
          continue
        clear(scratch)
        drawElement(scratch, element)
        const pixels = scratch.getImageData(
          point.x - radius,
          point.y - radius,
          radius * 2,
          radius * 2,
        )
        if (pixels.data.some((value, channel) => channel % 4 === 3 && value > 0)) return element
      }
      return undefined
    },
    hasInk() {
      return hasVisibleInk(context.getImageData(0, 0, sketchSize, sketchSize).data)
    },
    exportPNG() {
      const output = document.createElement('canvas')
      output.width = output.height = sketchSize
      const target = output.getContext('2d')
      if (!target) return Promise.resolve(null)
      target.fillStyle = '#fff'
      target.fillRect(0, 0, sketchSize, sketchSize)
      target.drawImage(canvas, 0, 0)
      return new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
    },
  }
}
