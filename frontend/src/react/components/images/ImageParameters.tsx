import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageInput } from '../../../api/images'
import type { ImageDraft } from '../../features/images/controller'
import { ratioBox } from '../../features/images/presentation'
import type { useImageOptions } from '../../features/images/options'
import { ChoiceGroup } from '../ui/choice-group'
import { selectClass } from '../ui/field'

/** Quality, ratio, size and count for one image draft; shared by the panel and the mobile sheet. */
export function ImageParameters({
  options,
  disabled,
  onPatch,
}: {
  options: ReturnType<typeof useImageOptions>
  disabled: boolean
  onPatch(value: Partial<ImageDraft>): void
}) {
  const { t } = useTranslation()
  const size = useId()
  return (
    <div className="flex flex-col gap-4">
      {options.priced.length ? (
        <ChoiceGroup
          label={t('images.quality')}
          value={options.quality}
          disabled={disabled || options.pricing}
          options={options.priced.map((quality) => ({
            value: quality,
            label: t('images.' + quality),
          }))}
          onChange={(quality) => onPatch({ quality: quality as ImageInput['quality'] })}
        />
      ) : null}
      {options.ratios.length ? (
        <ChoiceGroup
          variant="chips"
          label={t('images.ratio')}
          value={options.ratio}
          disabled={disabled}
          options={[
            {
              value: '',
              label: t('images.custom'),
              icon: (
                <span
                  aria-hidden="true"
                  className="block size-[18px] rounded-[3px] border-[1.5px] border-dashed border-current"
                />
              ),
            },
            ...options.ratios.map(([ratio]) => {
              const box = ratioBox(ratio)
              return {
                value: ratio,
                label: ratio,
                icon: (
                  <span aria-hidden="true" className="grid size-[18px] place-items-center">
                    <span
                      className="block rounded-[3px] border-[1.5px] border-current"
                      style={{ width: box.width, height: box.height }}
                    />
                  </span>
                ),
              }
            }),
          ]}
          onChange={(ratio) =>
            onPatch({
              ratio,
              size: options.ratios.find(([value]) => value === ratio)?.[1] ?? options.size,
            })
          }
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={size} className="text-xs font-medium text-muted-foreground">
          {t('images.size')}
        </label>
        <select
          id={size}
          aria-label={t('images.size')}
          className={selectClass + ' h-9'}
          value={options.size}
          disabled={disabled}
          onChange={(event) => onPatch({ size: event.target.value, ratio: '' })}
        >
          {options.sizes.map((value) => (
            <option key={value} value={value}>
              {value === 'auto' ? t('images.auto') : value.replace('x', ' × ')}
            </option>
          ))}
        </select>
      </div>
      {options.maxN ? (
        <ChoiceGroup
          label={t('images.count')}
          value={options.n}
          disabled={disabled}
          options={Array.from({ length: options.maxN }, (_, index) => ({
            value: index + 1,
            label: t('react.imageCount', { count: index + 1 }),
          }))}
          onChange={(n) => onPatch({ n })}
        />
      ) : null}
    </div>
  )
}
