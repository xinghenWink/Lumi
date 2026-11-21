import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { imageComplexityLevels, type ImageComplexity } from '../../../api/image-complexity'
import { Field } from '../ui/field'
import { NativeSelect, NativeSelectOption } from '../ui/native-select'

export function ImageComplexityField({
  value,
  disabled,
  size = 'default',
  onChange,
}: {
  value: ImageComplexity | undefined
  disabled: boolean
  size?: 'default' | 'sm'
  onChange(value: ImageComplexity | undefined): void
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <Field id={id} label={t('images.complexity')}>
      <NativeSelect
        id={id}
        size={size}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) =>
          onChange(imageComplexityLevels.find((level) => level === event.target.value))
        }
      >
        <NativeSelectOption value="">{t('images.complexityDefault')}</NativeSelectOption>
        {imageComplexityLevels.map((level) => (
          <NativeSelectOption key={level} value={level}>
            {t('images.complexityLevels.' + level)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}
