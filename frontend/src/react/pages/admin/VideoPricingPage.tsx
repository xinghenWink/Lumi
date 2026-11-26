import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { catalog } from '../../../api/catalog'
import {
  videoAPI,
  videoResolutions,
  type VideoCreditPool,
  type VideoPricing,
  type VideoResolution,
} from '../../../api/videos'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { NumberField, CheckField } from '../../components/admin/AdminFields'
import { Button } from '../../components/ui/button'
import { Field, selectClass } from '../../components/ui/field'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'

function WalletEditor({
  value,
  onSaved,
}: {
  value: VideoCreditPool
  onSaved(value: VideoCreditPool): void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [pool, setPool] = useState(value.pool)
  const save = useMutation({
    mutationFn: () => videoAPI.savePool({ ...value, pool }),
    onSuccess: onSaved,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('video.wallet')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <Field id={id} label={t('video.wallet')}>
            <select
              id={id}
              className={selectClass}
              value={pool}
              onChange={(event) => setPool(event.target.value === 'video' ? 'video' : 'permanent')}
            >
              <option value="video">{t('video.videoPool')}</option>
              <option value="permanent">{t('video.permanentPool')}</option>
            </select>
          </Field>
          <p className="text-sm text-muted-foreground">{t('video.poolHint')}</p>
          <ApiNotice error={save.error} />
          <Button className="w-fit" type="submit" disabled={save.isPending || pool === value.pool}>
            {t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function RatesEditor({
  value,
  onSaved,
}: {
  value: VideoPricing
  onSaved(value: VideoPricing): void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [mode, setMode] = useState(value.mode)
  const [rates, setRates] = useState(() =>
    value.rates.map((rate) => ({ id: crypto.randomUUID(), rate })),
  )
  const save = useMutation({
    mutationFn: () =>
      videoAPI.savePricing({
        ...value,
        mode,
        rates: rates.map(({ rate }) => ({
          resolution: rate.resolution,
          credits: rate.credits,
          has_video_reference: rate.has_video_reference,
          ...(mode === 'clip' ? { duration_seconds: rate.duration_seconds ?? 5 } : {}),
        })),
      }),
    onSuccess: onSaved,
  })
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <Field id={id} label={t('video.rateMode')}>
        <select
          id={id}
          className={selectClass}
          value={mode}
          onChange={(event) => setMode(event.target.value === 'clip' ? 'clip' : 'second')}
        >
          <option value="second">{t('video.second')}</option>
          <option value="clip">{t('video.clip')}</option>
        </select>
      </Field>
      {rates.map(({ id, rate }) => {
        const update = (patch: Partial<VideoPricing['rates'][number]>) =>
          setRates((items) =>
            items.map((item) => (item.id === id ? { id, rate: { ...item.rate, ...patch } } : item)),
          )
        return (
          <div
            key={id}
            className="grid items-end gap-3 rounded-xl border border-border p-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <Field id={id} label={t('video.resolution')}>
              <select
                id={id}
                className={selectClass}
                value={rate.resolution}
                onChange={(event) => update({ resolution: event.target.value as VideoResolution })}
              >
                {videoResolutions.map((size) => (
                  <option key={size} value={size}>
                    {size.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
            {mode === 'clip' ? (
              <NumberField
                label={t('video.duration')}
                value={rate.duration_seconds ?? 5}
                min={1}
                max={30}
                onChange={(duration_seconds) => update({ duration_seconds })}
              />
            ) : null}
            <NumberField
              label={t('video.rate')}
              value={rate.credits}
              min={0}
              max={1e9}
              onChange={(credits) => update({ credits })}
            />
            <CheckField
              label={t('video.hasVideo')}
              checked={rate.has_video_reference}
              onChange={(has_video_reference) => update({ has_video_reference })}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRates((items) => items.filter((row) => row.id !== id))}
            >
              {t('video.removeRate')}
            </Button>
          </div>
        )
      })}
      <ApiNotice error={save.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={rates.length >= 360}
          onClick={() =>
            setRates([
              ...rates,
              {
                id: crypto.randomUUID(),
                rate: { resolution: '720p', has_video_reference: false, credits: 1 },
              },
            ])
          }
        >
          {t('video.addRate')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}

export default function VideoPricingPage() {
  const { t } = useTranslation()
  const { user } = useSession()
  const [selection, setSelection] = useState('')
  const client = useQueryClient()
  const poolKey = ['user', user?.id, 'video-credit-pool']
  const pool = useQuery({
    queryKey: poolKey,
    queryFn: ({ signal }) => videoAPI.pool(signal),
    enabled: Boolean(user),
  })
  const models = useQuery({
    queryKey: ['user', user?.id, 'admin-video-models'],
    enabled: Boolean(user),
    queryFn: async ({ signal }) => {
      const result = []
      let cursor = ''
      do {
        const page = await catalog.models(
          new URLSearchParams({ type: 'video', limit: '100', cursor }),
          signal,
        )
        result.push(...page.items)
        cursor = page.next_cursor
      } while (cursor)
      return result
    },
  })
  const model = models.data?.find((row) => row.id === selection) ?? models.data?.[0]
  const ratesKey = ['user', user?.id, 'video-pricing', model?.id]
  const rates = useQuery({
    queryKey: ratesKey,
    enabled: Boolean(model),
    queryFn: ({ signal }) => videoAPI.pricing(model?.id ?? '', signal),
  })
  return (
    <div className="grid gap-5">
      <h1 className="text-xl font-semibold">{t('video.adminTitle')}</h1>
      <ApiNotice error={pool.error || models.error || rates.error} />
      {pool.data ? (
        <WalletEditor
          key={pool.data.version}
          value={pool.data}
          onSaved={(value) => client.setQueryData(poolKey, value)}
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('video.rates')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="video-pricing-model" label={t('video.model')}>
            <select
              id="video-pricing-model"
              className={selectClass}
              value={model?.id ?? ''}
              onChange={(event) => setSelection(event.target.value)}
            >
              {!model ? (
                <option value="">
                  {t(models.isPending ? 'common.loading' : 'video.noModels')}
                </option>
              ) : null}
              {models.data?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name}
                </option>
              ))}
            </select>
          </Field>
          {rates.data ? (
            <RatesEditor
              key={rates.data.model_id + ':' + rates.data.version}
              value={rates.data}
              onSaved={(value) => {
                client.setQueryData(ratesKey, value)
                void client.invalidateQueries({ queryKey: ['user', user?.id, 'video-options'] })
              }}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
