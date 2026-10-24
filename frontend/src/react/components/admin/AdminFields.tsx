import { useId } from 'react'
import { Field } from '../ui/field'
import { Input } from '../ui/input'

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  disabled = false,
}: {
  label: string
  value: number
  onChange(value: number): void
  min?: number
  max: number
  disabled?: boolean
}) {
  const id = useId()
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        type="number"
        step={1}
        min={min}
        max={max}
        required
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}
export function CheckField({
  label,
  checked,
  onChange,
  disabled = false,
  role,
}: {
  label: string
  checked: boolean
  onChange(value: boolean): void
  disabled?: boolean
  role?: 'switch'
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 text-sm">
      <input
        type="checkbox"
        role={role}
        className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}
