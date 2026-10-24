import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 min-w-0 w-full rounded-xl border border-border bg-card px-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50 sm:text-sm',
        className,
      )}
      {...props}
    />
  )
}
