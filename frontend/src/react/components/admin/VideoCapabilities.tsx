import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { videoAPI, videoModes, videoResolutions, type VideoProfile } from '../../../api/videos'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { Field, selectClass } from '../ui/field'
import { Input } from '../ui/input'
import { CheckField, NumberField } from './AdminFields'

const ratios = ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4', 'adaptive']
const emptyProfile: VideoProfile = {
  mode: 'text',
  ratios: ['16:9'],
  resolutions: ['720p'],
  durations: [5],
  max_images: 0,
  max_videos: 0,
  max_audio: 0,
  max_references: 0,
}
const toggle = <T,>(values: T[], item: T) =>
  values.includes(item) ? values.filter((v) => v !== item) : [...values, item]

export function VideoBinding({
  protocol,
  profile,
  change,
}: {
  protocol?: string
  profile?: string
  change(protocol: string, profile: string): void
}) {
  const { t } = useTranslation()
  const id = useId()
  const { user } = useSession()
  const bindings = useQuery({
    queryKey: ['user', user?.id, 'video-protocols'],
    queryFn: ({ signal }) => videoAPI.protocols(signal),
    enabled: Boolean(user),
  })
  const profiles = bindings.data?.find((item) => item.protocol === protocol)?.profiles ?? []
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ApiNotice error={bindings.error} />
      <Field id={id + '-protocol'} label={t('video.protocol')}>
        <select
          id={id + '-protocol'}
          className={selectClass}
          value={protocol ?? ''}
          onChange={(event) =>
            change(
              event.target.value,
              bindings.data?.find((item) => item.protocol === event.target.value)?.profiles[0] ??
                '',
            )
          }
        >
          <option value="">{t('catalog.chooseChannel')}</option>
          {bindings.data?.map(({ protocol }) => (
            <option key={protocol} value={protocol}>
              {protocol}
            </option>
          ))}
        </select>
      </Field>
      {protocol && profiles.length ? (
        <Field id={id + '-profile'} label={t('video.profile')}>
          <select
            id={id + '-profile'}
            className={selectClass}
            value={profile || profiles[0]}
            onChange={(event) => change(protocol, event.target.value)}
          >
            {profiles.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </div>
  )
}

function ProfileEditor({
  value,
  change,
}: {
  value: VideoProfile
  change(next: VideoProfile): void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [durations, setDurations] = useState(() => value.durations.join(', '))
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id + '-mode'} label={t('video.mode')}>
          <select
            id={id + '-mode'}
            className={selectClass}
            value={value.mode}
            onChange={(event) => {
              const mode = event.target.value as VideoProfile['mode']
              change({
                ...value,
                mode,
                max_images: mode === 'reference' ? 1 : 0,
                max_videos: 0,
                max_audio: 0,
                max_references: mode === 'reference' ? 1 : 0,
                allow_audio_only: false,
              })
            }}
          >
            {videoModes.map((mode) => (
              <option key={mode} value={mode}>
                {t('video.' + mode)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-duration'} label={t('video.durations')}>
          <Input
            id={id + '-duration'}
            required
            placeholder={t('video.durationsHint')}
            value={durations}
            onChange={(event) => {
              setDurations(event.target.value)
              change({
                ...value,
                durations: event.target.value
                  .split(/[,， ]+/)
                  .filter(Boolean)
                  .map(Number),
              })
            }}
          />
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm">{t('video.ratios')}</legend>
        {ratios.map((ratio) => (
          <Button
            key={ratio}
            size="sm"
            type="button"
            variant={value.ratios.includes(ratio) ? 'default' : 'outline'}
            aria-pressed={value.ratios.includes(ratio)}
            onClick={() => change({ ...value, ratios: toggle(value.ratios, ratio) })}
          >
            {ratio === 'adaptive' ? t('video.adaptive') : ratio}
          </Button>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm">{t('video.resolutions')}</legend>
        {videoResolutions.map((size) => (
          <Button
            key={size}
            size="sm"
            type="button"
            variant={value.resolutions.includes(size) ? 'default' : 'outline'}
            aria-pressed={value.resolutions.includes(size)}
            onClick={() => change({ ...value, resolutions: toggle(value.resolutions, size) })}
          >
            {size.toUpperCase()}
          </Button>
        ))}
      </fieldset>
      {value.mode === 'reference' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <CheckField
            label={t('video.allowVideo')}
            checked={value.max_videos > 0}
            onChange={(checked) => change({ ...value, max_videos: checked ? 1 : 0 })}
          />
          <CheckField
            label={t('video.audioOnly')}
            checked={value.allow_audio_only ?? false}
            onChange={(checked) => change({ ...value, allow_audio_only: checked })}
          />
          <NumberField
            label={t('video.maxImages')}
            value={value.max_images}
            min={0}
            max={30}
            onChange={(max_images) => change({ ...value, max_images })}
          />
          <NumberField
            label={t('video.maxVideos')}
            value={value.max_videos}
            min={0}
            max={10}
            onChange={(max_videos) => change({ ...value, max_videos })}
          />
          <NumberField
            label={t('video.maxAudio')}
            value={value.max_audio}
            min={0}
            max={10}
            onChange={(max_audio) => change({ ...value, max_audio })}
          />
          <NumberField
            label={t('video.maxRefs')}
            value={value.max_references}
            min={1}
            max={50}
            onChange={(max_references) => change({ ...value, max_references })}
          />
        </div>
      ) : null}
    </div>
  )
}

export function VideoCapabilitiesEditor({
  profiles,
  change,
}: {
  profiles: VideoProfile[]
  change(profiles: VideoProfile[]): void
}) {
  const { t } = useTranslation()
  const [ids, setIds] = useState(() => profiles.map(() => crypto.randomUUID()))
  return (
    <div className="grid gap-2">
      {profiles.map((value, index) => (
        <section
          key={ids[index] ?? index}
          className="grid gap-2 rounded-lg border border-border p-3"
        >
          <ProfileEditor
            value={value}
            change={(next) => change(profiles.map((item, at) => (at === index ? next : item)))}
          />
          {profiles.length > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="justify-self-end"
              onClick={() => {
                setIds(ids.filter((_, at) => at !== index))
                change(profiles.filter((_, at) => at !== index))
              }}
            >
              {t('video.removeProfile')}
            </Button>
          ) : null}
        </section>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={profiles.length >= 32}
        onClick={() => {
          setIds([...ids, crypto.randomUUID()])
          change([...profiles, emptyProfile])
        }}
      >
        {t('video.addProfile')}
      </Button>
    </div>
  )
}
