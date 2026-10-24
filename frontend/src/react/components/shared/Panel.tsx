import type { ReactNode } from 'react'
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
    <section className={'min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6 ' + className}>
      {title || description ? (
        <header className="mb-5">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
          {description ? (
            <p className="mt-2 text-xs leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}
