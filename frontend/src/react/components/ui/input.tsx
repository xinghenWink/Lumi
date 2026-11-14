import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 min-w-0 w-full rounded-lg border border-input bg-card px-3 text-base shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/15 aria-invalid:border-destructive aria-invalid:focus:ring-destructive/20 disabled:opacity-50 sm:text-sm',
        className,
      )}
      {...props}
    />
  )
}
