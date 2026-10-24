import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export function ImageFilters({
  admin = false,
  onApply,
}: {
  admin?: boolean
  onApply(query: URLSearchParams): void
}) {
  const { t } = useTranslation(),
    id = useId()
  const [values, setValues] = useState({ state: '', quality: '', from: '', until: '', user: '' })
  const field =
    'min-w-0 rounded-lg border border-border bg-card p-2 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm'
  return (
    <form
      className="grid shrink-0 grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
      onSubmit={(event) => {
        event.preventDefault()
        const query = new URLSearchParams({ limit: '40' })
        for (const key of ['state', 'quality'] as const)
          if (values[key]) query.set(key, values[key])
        if (values.from) query.set('from', new Date(values.from + 'T00:00:00Z').toISOString())
        if (values.until) {
          const date = new Date(values.until + 'T00:00:00Z')
          date.setUTCDate(date.getUTCDate() + 1)
          query.set('until', date.toISOString())
        }
        if (admin && values.user.trim()) query.set('user_id', values.user.trim())
        onApply(query)
      }}
    >
      {admin ? (
        <label
          htmlFor={id + '-user'}
          className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"
        >
          {t('images.user')}
          <Input
            id={id + '-user'}
            value={values.user}
            onChange={(event) => setValues({ ...values, user: event.target.value })}
            maxLength={36}
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          />
        </label>
      ) : null}
      <label
        htmlFor={id + '-quality'}
        className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"
      >
        {t('images.quality')}
        <select
          id={id + '-quality'}
          aria-label={t('images.quality')}
          className={field}
          value={values.quality}
          onChange={(event) => setValues({ ...values, quality: event.target.value })}
        >
          <option value="">{t('images.all')}</option>
          {['low', 'medium', 'high'].map((quality) => (
            <option key={quality} value={quality}>
              {t('images.' + quality)}
            </option>
          ))}
        </select>
      </label>
      <label
        htmlFor={id + '-state'}
        className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"
      >
        {t('images.status')}
        <select
          id={id + '-state'}
          aria-label={t('images.status')}
          className={field}
          value={values.state}
          onChange={(event) => setValues({ ...values, state: event.target.value })}
        >
          <option value="">{t('images.all')}</option>
          {['queued', 'running', 'succeeded', 'partial', 'failed', 'canceled'].map((status) => (
            <option key={status} value={status}>
              {t('images.' + status)}
            </option>
          ))}
        </select>
      </label>
      <label
        htmlFor={id + '-from'}
        className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"
      >
        {t('images.from')}
        <input
          id={id + '-from'}
          type="date"
          className={field}
          value={values.from}
          max={values.until || undefined}
          onChange={(event) => setValues({ ...values, from: event.target.value })}
        />
      </label>
      <label
        htmlFor={id + '-until'}
        className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"
      >
        {t('images.until')}
        <input
          id={id + '-until'}
          type="date"
          className={field}
          value={values.until}
          min={values.from || undefined}
          onChange={(event) => setValues({ ...values, until: event.target.value })}
        />
      </label>
      <Button type="submit" variant="outline">
        {t('images.filter')}
      </Button>
    </form>
  )
}
