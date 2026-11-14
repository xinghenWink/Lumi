import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { boundsOf, centerOn, visibleRect, type Rect } from '../../../features/canvas/geometry'
import { useCanvas, useEditor } from '../../features/canvas/context'

const WIDTH = 200,
  HEIGHT = 140,
  PAD = 8

/**
 * Overview of every node with the visible area outlined. Clicking or dragging recenters
 * the stage on that point.
 */
export function CanvasMiniMap() {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const nodes = useEditor((state) => state.doc.nodes)
  const viewport = useEditor((state) => state.viewport)
  const stage = useEditor((state) => state.stage)
  const dragging = useRef(false)
  const view = visibleRect(viewport, stage)
  const world: Rect = boundsOf([...nodes, view]) ?? { x: 0, y: 0, w: 1, h: 1 }
  const scale = Math.min(
    (WIDTH - PAD * 2) / Math.max(world.w, 1),
    (HEIGHT - PAD * 2) / Math.max(world.h, 1),
  )
  const offsetX = PAD + (WIDTH - PAD * 2 - world.w * scale) / 2,
    offsetY = PAD + (HEIGHT - PAD * 2 - world.h * scale) / 2
  const map = (rect: Rect) => ({
    x: offsetX + (rect.x - world.x) * scale,
    y: offsetY + (rect.y - world.y) * scale,
    width: Math.max(rect.w * scale, 1.5),
    height: Math.max(rect.h * scale, 1.5),
  })
  function jump(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = {
      x: world.x + (event.clientX - bounds.left - offsetX) / scale,
      y: world.y + (event.clientY - bounds.top - offsetY) / scale,
    }
    editor.setViewport(centerOn(editor.state.viewport, point, editor.state.stage))
  }
  const frame = map(view)
  return (
    <svg
      role="img"
      aria-label={t('canvas.minimap.label')}
      data-testid="canvas-minimap"
      width={WIDTH}
      height={HEIGHT}
      className="cursor-pointer touch-none rounded-xl border border-border bg-card/95 shadow-md"
      onPointerDown={(event) => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        jump(event)
      }}
      onPointerMove={(event) => {
        if (dragging.current) jump(event)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    >
      {nodes.map((node) => {
        const box = map(node)
        return (
          <rect
            key={node.id}
            {...box}
            rx={1.5}
            className={
              node.kind === 'group'
                ? 'fill-none stroke-input'
                : node.kind === 'generator'
                  ? 'fill-primary/60'
                  : 'fill-muted-foreground/40'
            }
          />
        )
      })}
      <rect {...frame} rx={2} className="fill-primary/5 stroke-primary" strokeWidth={1.25} />
    </svg>
  )
}
