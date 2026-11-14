import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CanvasEdge } from '../../../api/canvases'
import {
  edgePath,
  inputPort,
  outputPort,
  type Point,
  type Rect,
} from '../../../features/canvas/geometry'
import { cn } from '../../lib/utils'

/**
 * Draws connections in world coordinates. A wide transparent stroke under each line
 * makes edges easy to pick at any zoom level.
 */
export const CanvasEdges = memo(function CanvasEdges({
  edges,
  rects,
  selected,
  zoom,
  draft,
}: {
  edges: readonly CanvasEdge[]
  rects: ReadonlyMap<string, Rect>
  selected: readonly string[]
  zoom: number
  draft: { from: Point; to: Point } | null
}) {
  const { t } = useTranslation()
  const width = 1.75 / zoom
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={1}
      height={1}
    >
      {edges.map((edge) => {
        const from = rects.get(edge.from),
          to = rects.get(edge.to)
        if (!from || !to) return null
        const path = edgePath(outputPort(from), inputPort(to))
        const active = selected.includes(edge.id)
        return (
          <g key={edge.id}>
            <path
              d={path}
              data-edge-id={edge.id}
              pointerEvents="stroke"
              className="cursor-pointer fill-none stroke-transparent"
              strokeWidth={Math.max(12 / zoom, 6)}
            >
              <title>{t('canvas.nodes.edge')}</title>
            </path>
            <path
              d={path}
              className={cn(
                'fill-none',
                active
                  ? 'stroke-primary'
                  : edge.kind === 'result'
                    ? 'stroke-muted-foreground/50'
                    : 'stroke-primary/60',
              )}
              strokeWidth={active ? width * 1.8 : width}
              strokeDasharray={edge.kind === 'result' ? `${5 / zoom} ${4 / zoom}` : undefined}
            />
          </g>
        )
      })}
      {draft ? (
        <path
          d={edgePath(draft.from, draft.to)}
          className="fill-none stroke-primary"
          strokeWidth={width}
          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
        />
      ) : null}
    </svg>
  )
})
