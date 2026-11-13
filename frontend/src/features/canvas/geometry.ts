import type { CanvasNode, CanvasViewport } from '../../api/canvases'
import { clamp, LIMITS } from './document'

export interface Point {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Size {
  width: number
  height: number
}

/**
 * The viewport translates the world origin to (x, y) screen pixels and scales it by zoom,
 * so screen = world * zoom + offset.
 */
export function screenToWorld(point: Point, viewport: CanvasViewport): Point {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }
}
export function worldToScreen(point: Point, viewport: CanvasViewport): Point {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y }
}

export const clampZoom = (zoom: number) => clamp(zoom, LIMITS.minZoom, LIMITS.maxZoom)

/** Zooms around a screen point so the world point under it stays in place. */
export function zoomAt(viewport: CanvasViewport, point: Point, zoom: number): CanvasViewport {
  const next = clampZoom(zoom)
  const anchor = screenToWorld(point, viewport)
  return { x: point.x - anchor.x * next, y: point.y - anchor.y * next, zoom: next }
}

/** Wheel and trackpad deltas become a multiplicative zoom step (negative delta zooms in). */
export function wheelZoom(viewport: CanvasViewport, point: Point, deltaY: number) {
  return zoomAt(viewport, point, viewport.zoom * Math.exp(-clamp(deltaY, -100, 100) * 0.0025))
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.w)
    bottom = Math.max(bottom, rect.y + rect.h)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Fits a world rectangle into the screen without zooming past 100%. */
export function fitBounds(rect: Rect | null, size: Size, padding = 64): CanvasViewport {
  if (!rect || size.width <= 0 || size.height <= 0)
    return { x: size.width / 2, y: size.height / 2, zoom: 1 }
  const zoom = clampZoom(
    Math.min(
      (size.width - padding * 2) / Math.max(rect.w, 1),
      (size.height - padding * 2) / Math.max(rect.h, 1),
      1,
    ),
  )
  return {
    x: size.width / 2 - (rect.x + rect.w / 2) * zoom,
    y: size.height / 2 - (rect.y + rect.h / 2) * zoom,
    zoom,
  }
}

/** Centers a world point on screen at the current zoom. */
export function centerOn(viewport: CanvasViewport, point: Point, size: Size): CanvasViewport {
  return {
    ...viewport,
    x: size.width / 2 - point.x * viewport.zoom,
    y: size.height / 2 - point.y * viewport.zoom,
  }
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function contains(rect: Rect, point: Point) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  )
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

/** The world area on screen, grown by a margin in screen pixels. */
export function visibleRect(viewport: CanvasViewport, size: Size, margin = 0): Rect {
  const topLeft = screenToWorld({ x: -margin, y: -margin }, viewport)
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: (size.width + margin * 2) / viewport.zoom,
    h: (size.height + margin * 2) / viewport.zoom,
  }
}

export function visibleNodes(
  nodes: readonly CanvasNode[],
  viewport: CanvasViewport,
  size: Size,
  margin = Math.max(size.width, size.height),
) {
  const area = visibleRect(viewport, size, margin)
  return nodes.filter((node) => intersects(node, area))
}

export const outputPort = (rect: Rect): Point => ({ x: rect.x + rect.w, y: rect.y + rect.h / 2 })
export const inputPort = (rect: Rect): Point => ({ x: rect.x, y: rect.y + rect.h / 2 })

/** A horizontal cubic Bézier between two ports. */
export function edgePath(from: Point, to: Point) {
  const bend = Math.max(48, Math.abs(to.x - from.x) / 2)
  const r = (value: number) => Math.round(value * 10) / 10
  return `M ${r(from.x)} ${r(from.y)} C ${r(from.x + bend)} ${r(from.y)}, ${r(to.x - bend)} ${r(to.y)}, ${r(to.x)} ${r(to.y)}`
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
