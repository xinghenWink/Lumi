import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Label } from './label'
export const selectClass =
  'lumi-select h-10 min-w-0 w-full rounded-lg border border-input bg-card px-3 text-base shadow-xs outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-50 sm:text-sm'
export const textareaClass =
  'min-w-0 w-full rounded-lg border border-input bg-card p-3 text-base shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-50 sm:text-sm'
export function FieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('flex flex-col gap-4', className)} {...props} />
}

export function Field({
  id,
  label,
  hint,
  invalid,
  children,
}: {
  id: string
  label: string
  hint?: string
  invalid?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-slot="field"
      data-invalid={invalid || undefined}
      className="flex min-w-0 flex-col gap-1.5"
    >
      <Label htmlFor={id} className="text-xs leading-normal font-medium text-foreground">
        {label}
      </Label>
      {children}
      {hint ? (
        <p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
