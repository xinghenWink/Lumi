import type { ReactNode } from 'react'
export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-xs leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </header>
      {children}
    </div>
  )
}
