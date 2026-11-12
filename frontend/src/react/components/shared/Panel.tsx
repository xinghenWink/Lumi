import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
export function Panel({
  title,
  description,
  className = '',
  children,
}: {
  title?: string
  description?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6',
        className,
      )}
    >
      {title || description ? (
        <header className="mb-5">
          {title ? <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2> : null}
          {description ? (
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}
