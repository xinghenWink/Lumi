import type { ReactNode } from 'react'
export const selectClass =
  'h-11 min-w-0 w-full rounded-xl border border-border bg-card px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50 sm:text-sm'
export const textareaClass =
  'min-w-0 w-full rounded-xl border border-border bg-card p-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50 sm:text-sm'
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
