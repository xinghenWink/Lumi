import { Ban, ImageUp } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

/** Page-wide drop affordance; decorative because the composer announces results. */
export default function DropOverlay({
  enabled,
  title,
  hint,
}: {
  enabled: boolean
  title: string
  hint: string
}) {
  return createPortal(
    <div
      aria-hidden="true"
      data-drop-overlay
      className="pointer-events-none fixed inset-0 z-[45] p-3 animate-fade-in sm:p-4"
    >
      <div
        className={cn(
          'grid size-full place-items-center rounded-3xl border-2 border-dashed backdrop-blur-[3px]',
          enabled ? 'border-primary/55 bg-background/80' : 'border-input bg-background/85',
        )}
      >
        <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center animate-rise-in">
          <span
            className={cn(
              'grid size-14 place-items-center rounded-2xl shadow-sm',
              enabled ? 'bg-accent text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {enabled ? <ImageUp size={26} strokeWidth={1.8} /> : <Ban size={24} />}
          </span>
          <p className="text-base font-semibold tracking-tight">{title}</p>
          {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
