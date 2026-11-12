import type { ReactNode } from 'react'
export const selectClass =
  'lumi-select h-10 min-w-0 w-full rounded-lg border border-input bg-card px-3 text-base shadow-xs outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-50 sm:text-sm'
export const textareaClass =
  'min-w-0 w-full rounded-lg border border-input bg-card p-3 text-base shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-50 sm:text-sm'
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
