import { Video } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Frame, ImagePlus, Sparkles, Type } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Point } from '../../../features/canvas/geometry'
import type { CreateKind } from '../../features/canvas/actions'

export interface CreateMenuAnchor {
  point: Point
  source?: string
}

const items = [
  { kind: 'text', icon: Type, label: 'canvas.nodes.text' },
  { kind: 'image', icon: ImagePlus, label: 'canvas.nodes.image' },
  { kind: 'video', icon: Video, label: 'video.node' },
  { kind: 'generator', icon: Sparkles, label: 'canvas.nodes.generator' },
  { kind: 'group', icon: Frame, label: 'canvas.nodes.group' },
] as const

export function CanvasCreateMenu({
  anchor,
  width,
  height,
  onChoose,
  onDismiss,
}: {
  anchor: CreateMenuAnchor
  width: number
  height: number
  onChoose(kind: CreateKind): void
  onDismiss(): void
}) {
  const { t } = useTranslation()
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector('button')?.focus({ preventScroll: true })
  }, [])
  const options = anchor.source ? items.filter(({ kind }) => kind !== 'group') : items
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={t('canvas.tools.create')}
      data-canvas-menu
      className="absolute z-20 grid w-44 gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg"
      style={{
        left: Math.max(8, Math.min(anchor.point.x, width - 184)),
        top: Math.max(8, Math.min(anchor.point.y, height - (options.length * 41 + 20))),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss()
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
          const index = buttons.findIndex((button) => button === document.activeElement)
          const direction = event.key === 'ArrowDown' ? 1 : -1
          buttons[(index + direction + buttons.length) % buttons.length]?.focus()
        } else return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {options.map(({ kind, icon: Icon, label }) => (
        <button
          key={kind}
          type="button"
          role="menuitem"
          className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          onClick={() => onChoose(kind)}
        >
          <Icon size={16} aria-hidden="true" />
          {t(label)}
        </button>
      ))}
    </div>
  )
}
