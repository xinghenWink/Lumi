import { useId, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const presets: readonly (readonly [string, readonly (readonly [number, number])[]])[] = [
  [
    '1:1',
    [
      [512, 512],
      [1024, 1024],
      [2048, 2048],
    ],
  ],
  [
    '3:2',
    [
      [1536, 1024],
      [2304, 1536],
      [3072, 2048],
    ],
  ],
  [
    '2:3',
    [
      [1024, 1536],
      [1536, 2304],
      [2048, 3072],
    ],
  ],
  [
    '4:3',
    [
      [1024, 768],
      [1536, 1152],
      [2048, 1536],
    ],
  ],
  [
    '3:4',
    [
      [768, 1024],
      [1152, 1536],
      [1536, 2048],
    ],
  ],
  [
    '16:9',
    [
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ],
  ],
  [
    '9:16',
    [
      [720, 1280],
      [1080, 1920],
      [1440, 2560],
      [2160, 3840],
    ],
  ],
]
const custom = 'custom'
const limit = 8192
const chip =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50'
const idle = 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground'
const active = 'border-primary/60 bg-accent font-medium text-primary'

const label = (size: string) => size.replace('x', ' × ')

/** Image sizes for a model: pick a ratio, then a preset resolution or type width × height. */
export function SizePicker({
  value,
  onChange,
  max = 20,
}: {
  value: readonly string[]
  onChange(value: string[]): void
  max?: number
}) {
  const { t } = useTranslation(),
    id = useId()
  const [ratio, setRatio] = useState('1:1')
  const [width, setWidth] = useState(''),
    [height, setHeight] = useState('')
  const [problem, setProblem] = useState('')
  const parts = ratio === custom ? undefined : ratio.split(':').map(Number)
  const full = value.length >= max
  function toggle(size: string) {
    setProblem('')
    if (value.includes(size)) onChange(value.filter((item) => item !== size))
    else if (full) setProblem(t('catalog.sizeLimit', { count: max }))
    else onChange([...value, size])
  }
  // With a ratio selected, typing one edge fills in the other; "custom" keeps them independent.
  function edge(next: string, which: 'width' | 'height') {
    setProblem('')
    const set = which === 'width' ? setWidth : setHeight,
      other = which === 'width' ? setHeight : setWidth
    set(next)
    const number = Number(next)
    if (!parts || !Number.isInteger(number) || number < 1) return
    const [w = 1, h = 1] = parts
    other(String(Math.round(which === 'width' ? (number * h) / w : (number * w) / h)))
  }
  function add() {
    const w = Number(width),
      h = Number(height)
    if (![w, h].every((n) => Number.isInteger(n) && n >= 1 && n <= limit)) {
      setProblem(t('catalog.sizeInvalid', { max: limit }))
      return
    }
    const size = w + 'x' + h
    if (value.includes(size)) {
      setProblem(t('catalog.sizeDuplicate'))
      return
    }
    if (full) {
      setProblem(t('catalog.sizeLimit', { count: max }))
      return
    }
    onChange([...value, size])
    setWidth('')
    setHeight('')
    setProblem('')
  }
  const options = presets.find(([key]) => key === ratio)?.[1] ?? []
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="mb-1.5 text-xs font-medium">{t('catalog.sizes')}</legend>
      <div className="flex min-h-8 flex-wrap gap-1.5" aria-live="polite">
        {value.length ? (
          value.map((size) => (
            <span
              key={size}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent pr-1 pl-2.5 text-xs font-medium text-primary tabular-nums"
            >
              {size === 'auto' ? t('catalog.sizeAuto') : label(size)}
              <button
                type="button"
                className="grid size-6 place-items-center rounded-md hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={t('catalog.sizeRemove', {
                  size: size === 'auto' ? t('catalog.sizeAuto') : label(size),
                })}
                onClick={() => toggle(size)}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </span>
          ))
        ) : (
          <span className="self-center text-xs text-destructive">{t('catalog.sizeEmpty')}</span>
        )}
      </div>
      <div className="grid gap-3 rounded-xl border border-border bg-muted/35 p-3">
        <div className="grid gap-1.5">
          <span id={id + '-ratio'} className="text-xs text-muted-foreground">
            {t('catalog.sizeRatio')}
          </span>
          <div role="group" aria-labelledby={id + '-ratio'} className="flex flex-wrap gap-1.5">
            {[...presets.map(([key]) => key), custom].map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={ratio === key}
                className={cn(chip, ratio === key ? active : idle)}
                onClick={() => {
                  setRatio(key)
                  setWidth('')
                  setHeight('')
                  setProblem('')
                }}
              >
                {key === custom ? t('catalog.sizeCustom') : key}
              </button>
            ))}
          </div>
        </div>
        {options.length ? (
          <div className="grid gap-1.5">
            <span id={id + '-presets'} className="text-xs text-muted-foreground">
              {t('catalog.sizePresets')}
            </span>
            <div role="group" aria-labelledby={id + '-presets'} className="flex flex-wrap gap-1.5">
              {options.map(([w, h]) => {
                const size = w + 'x' + h,
                  selected = value.includes(size)
                return (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={selected}
                    className={cn(chip, 'tabular-nums', selected ? active : idle)}
                    onClick={() => toggle(size)}
                  >
                    {selected ? <Check size={12} strokeWidth={2.5} /> : null}
                    {label(size)}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">{t('catalog.sizeManual')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={limit}
              step={1}
              aria-label={t('catalog.sizeWidth')}
              placeholder={t('catalog.sizeWidth')}
              className="h-9 w-24"
              value={width}
              onChange={(event) => edge(event.target.value, 'width')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  add()
                }
              }}
            />
            <span aria-hidden="true" className="text-muted-foreground">
              ×
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={limit}
              step={1}
              aria-label={t('catalog.sizeHeight')}
              placeholder={t('catalog.sizeHeight')}
              className="h-9 w-24"
              value={height}
              onChange={(event) => edge(event.target.value, 'height')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  add()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!width || !height}
              onClick={add}
            >
              <Plus size={14} />
              {t('catalog.sizeAdd')}
            </Button>
            <button
              type="button"
              aria-pressed={value.includes('auto')}
              className={cn(chip, 'h-9', value.includes('auto') ? active : idle)}
              onClick={() => toggle('auto')}
            >
              {value.includes('auto') ? <Check size={12} strokeWidth={2.5} /> : null}
              {t('catalog.sizeAuto')}
            </button>
          </div>
        </div>
        {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t('catalog.sizesHint')}</p>
    </fieldset>
  )
}
