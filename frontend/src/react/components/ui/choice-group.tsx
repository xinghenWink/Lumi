import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface Choice<T extends string | number> {
  value: T
  label: ReactNode
  /** Decorative content shown above the label in the chips variant. */
  icon?: ReactNode
}

/**
 * Native radio group styled as a segmented control or chips. Each radio covers its
 * own option, so pointer, keyboard (arrow keys) and assistive technology behave like
 * platform radios, and labels give every option its accessible name.
 */
export function ChoiceGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  variant = 'segmented',
  className,
}: {
  label: string
  value: T
  options: readonly Choice<T>[]
  onChange(value: T): void
  disabled?: boolean
  variant?: 'segmented' | 'chips'
  className?: string
}) {
  const id = useId()
  const chips = variant === 'chips'
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span id={id + '-label'} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id + '-label'}
        aria-disabled={disabled || undefined}
        className={
          chips
            ? 'grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-1.5'
            : 'flex rounded-lg bg-muted p-0.5'
        }
      >
        {options.map((option) => (
          <label key={String(option.value)} className="relative flex min-w-0 flex-1">
            <input
              type="radio"
              name={id}
              value={String(option.value)}
              checked={option.value === value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-md opacity-0 disabled:cursor-not-allowed"
            />
            <span
              className={cn(
                'flex w-full min-w-0 items-center justify-center text-xs transition-[background-color,border-color,color,box-shadow] duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring peer-disabled:opacity-50',
                chips
                  ? 'h-14 flex-col gap-1 rounded-lg border border-border bg-card text-muted-foreground peer-hover:border-input peer-checked:border-primary/60 peer-checked:bg-accent peer-checked:font-medium peer-checked:text-primary'
                  : 'h-8 truncate rounded-md px-2 text-muted-foreground peer-hover:text-foreground peer-checked:bg-card peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-xs',
              )}
            >
              {option.icon}
              <span className="truncate">{option.label}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
