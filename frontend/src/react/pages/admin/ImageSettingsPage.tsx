import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { images, type ImageConfiguration, type ImageResolutionPreset } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { parseRatioMapping } from '../../features/admin/options'
import { invalidateCatalog } from '../../features/admin/catalog'
import { AdminPage } from '../../components/admin/AdminPage'
import { CheckField, NumberField, unboundedCount } from '../../components/admin/AdminFields'
import { Panel } from '../../components/shared/Panel'
import { PageStatus } from '../../components/shared/PageStatus'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { Field, textareaClass } from '../../components/ui/field'
import { Button } from '../../components/ui/button'

const fields = [
  ['max_n', 1, 4],
  ['max_references', 0, unboundedCount],
  ['max_upload_bytes', 1024, 10485760],
  ['per_user_concurrency', 1, 20],
  ['global_concurrency', 1, 20],
  ['timeout_seconds', 5, 600],
  ['queue_timeout_seconds', 60, 86400],
  ['retention_days', 0, 3650],
] as const
const ratioText = (value: ImageConfiguration) =>
  Object.entries(value.ratio_sizes)
    .map(([ratio, size]) => ratio + '=' + size)
    .join('\n')

function toggled<T>(disabled: T[], value: T, enabled: boolean): T[] {
  return enabled ? disabled.filter((item) => item !== value) : [...disabled, value]
}

function PresetSwitches({
  form,
  onChange,
}: {
  form: ImageConfiguration
  onChange(patch: Pick<ImageConfiguration, 'disabled_ratios' | 'disabled_resolutions'>): void
}) {
  const { t } = useTranslation()
  const presets: ImageResolutionPreset[] = form.resolution_presets ?? []
  const ratios = ['auto' as const, ...new Set(presets.map((preset) => preset.ratio))]
  const resolutions = [...new Set(presets.map((preset) => preset.resolution))]
  const disabledRatios = form.disabled_ratios ?? []
  const disabledResolutions = form.disabled_resolutions ?? []
  if (!presets.length) return null
  return (
    <section className="grid gap-3 rounded-xl border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">{t('images.presetTitle')}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('images.presetHint')}</p>
      </div>
      <fieldset>
        <legend className="text-xs font-medium">{t('images.ratio')}</legend>
        <div className="grid grid-cols-3 gap-x-4 sm:flex sm:flex-wrap">
          {ratios.map((ratio) => {
            const checked = !disabledRatios.includes(ratio)
            return (
              <CheckField
                key={ratio}
                role="switch"
                label={ratio === 'auto' ? t('images.auto') : ratio}
                checked={checked}
                disabled={checked && ratios.length - disabledRatios.length === 1}
                onChange={(enabled) =>
                  onChange({ disabled_ratios: toggled(disabledRatios, ratio, enabled) })
                }
              />
            )
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-medium">{t('images.resolution')}</legend>
        <div className="flex flex-wrap gap-x-4">
          {resolutions.map((resolution) => {
            const checked = !disabledResolutions.includes(resolution)
            return (
              <CheckField
                key={resolution}
                role="switch"
                label={resolution.toUpperCase()}
                checked={checked}
                disabled={checked && resolutions.length - disabledResolutions.length === 1}
                onChange={(enabled) =>
                  onChange({
                    disabled_resolutions: toggled(disabledResolutions, resolution, enabled),
                  })
                }
              />
            )
          })}
        </div>
      </fieldset>
    </section>
  )
}

function ConfigurationForm({
  initial,
  reload,
}: {
  initial: ImageConfiguration
  reload(): Promise<ImageConfiguration>
}) {
  const { user } = useSession(),
    runtime = useRuntime(),
    { t } = useTranslation(),
    id = useId()
  const [form, setForm] = useState(() => structuredClone(initial)),
    [sizes, setSizes] = useState(initial.sizes.join('\n')),
    [ratios, setRatios] = useState(ratioText(initial)),
    [notice, setNotice] = useState(false)
  function apply(result: ImageConfiguration) {
    setForm(result)
    setSizes(result.sizes.join('\n'))
    setRatios(ratioText(result))
  }
  const refresh = useOwnedMutation(user?.id, async (check) => {
    const result = await reload()
    check()
    apply(result)
    setNotice(false)
  })
  const save = useOwnedMutation(user?.id, async (check) => {
    const result = await images.saveOptions({
      ...form,
      sizes: sizes
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      ratio_sizes: parseRatioMapping(ratios),
    })
    check()
    apply(result)
    setNotice(true)
    runtime.queryClient.setQueryData(['user', user?.id, 'admin-image-settings'], result)
    invalidateCatalog(runtime, user?.id)
  })
  return (
    <Panel>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          setNotice(false)
          save.mutate()
        }}
      >
        <fieldset className="grid min-w-0 gap-5" disabled={save.isPending || refresh.isPending}>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(([key, min, max]) => (
              <NumberField
                key={key}
                label={t(`images.${key}`)}
                value={form[key]}
                min={min}
                max={max}
                onChange={(value) => setForm({ ...form, [key]: value })}
              />
            ))}
          </div>
          <PresetSwitches form={form} onChange={(patch) => setForm({ ...form, ...patch })} />
          <details className="grid gap-4 rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t('images.customSizes')}
            </summary>
            <div className="mt-4 grid gap-4">
              <Field id={id + '-sizes'} label={t('images.sizes')}>
                <textarea
                  id={id + '-sizes'}
                  className={textareaClass}
                  rows={5}
                  required
                  value={sizes}
                  onChange={(event) => setSizes(event.target.value)}
                />
              </Field>
              <Field id={id + '-ratios'} label={t('images.ratio_sizes')}>
                <textarea
                  id={id + '-ratios'}
                  className={textareaClass}
                  rows={7}
                  value={ratios}
                  onChange={(event) => setRatios(event.target.value)}
                />
              </Field>
            </div>
          </details>
          <CheckField
            label={t('images.split_requests')}
            checked={form.split_requests}
            onChange={(split_requests) => setForm({ ...form, split_requests })}
          />
          <CheckField
            label={t('images.admin_can_view_content')}
            checked={form.admin_can_view_content}
            onChange={(admin_can_view_content) => setForm({ ...form, admin_can_view_content })}
          />
          <p className="text-xs leading-6 text-muted-foreground">{t('images.contentWarning')}</p>
        </fieldset>
        <ApiNotice error={save.error || refresh.error} />
        {notice ? (
          <p role="status" className="text-xs text-primary">
            {t('images.saved')}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending || refresh.isPending}
            onClick={() => {
              save.reset()
              refresh.mutate()
            }}
          >
            {t('common.refresh')}
          </Button>
          <Button type="submit" disabled={save.isPending || refresh.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
export default function ImageSettingsPage() {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-image-settings'],
    enabled: !!user,
    queryFn: ({ signal }) => images.options(true, signal),
    staleTime: 0,
  })
  return (
    <AdminPage title={t('images.settingsTitle')} description={t('images.settingsHint')}>
      {query.data ? (
        <ConfigurationForm
          initial={query.data}
          reload={async () => {
            const result = await query.refetch()
            if (result.error) throw result.error
            if (!result.data) throw new ApiError('RESPONSE_INVALID')
            return result.data
          }}
        />
      ) : (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      )}
    </AdminPage>
  )
}
