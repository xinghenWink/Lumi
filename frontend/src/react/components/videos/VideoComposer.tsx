import { useEffect, useId, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AtSign, Film, Upload, X } from 'lucide-react'
import { ApiError } from '../../../api/transport'
import {
  videoAPI,
  type VideoAsset,
  type VideoInput,
  type VideoProfile,
  type VideoQuote,
  type VideoReference,
  type VideoResolution,
  type VideoSubmission,
  type VideoTask,
} from '../../../api/videos'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Field, selectClass } from '../ui/field'
import { ModalDialog } from '../ui/modal-dialog'
import { Textarea } from '../ui/textarea'

type Role = VideoReference['role']
type Choice = {
  ratio: string
  resolution: VideoResolution
  duration: number
  unit: number
  priced: boolean
  profile: VideoProfile
}

function assetType(asset: VideoAsset) {
  if (asset.mime.startsWith('video/')) return 'video'
  if (asset.mime.startsWith('audio/')) return 'audio'
  return 'image'
}

function useVideoOptions() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['user', user?.id, 'video-options'],
    queryFn: ({ signal }) => videoAPI.options(signal),
    enabled: Boolean(user),
  })
}

export function VideoComposer({
  initial,
  autoQuote = false,
  linked = [],
  sourceText = '',
  onSubmitted,
  quoteVideo = videoAPI.quote,
  submitVideo = videoAPI.submit,
}: {
  initial?: VideoInput
  autoQuote?: boolean
  linked?: VideoReference[]
  sourceText?: string
  onSubmitted(task: VideoTask, input: VideoInput): void
  quoteVideo?(input: VideoInput): Promise<VideoQuote>
  submitVideo?(body: VideoSubmission, key: string): Promise<VideoTask>
}) {
  const { t } = useTranslation()
  const id = useId()
  const options = useVideoOptions()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [modelId, setModelId] = useState(initial?.model_id ?? '')
  const [mode, setMode] = useState<VideoInput['mode']>(
    initial?.mode ?? (linked.length ? 'reference' : 'text'),
  )
  const [ratio, setRatio] = useState(initial?.ratio ?? '16:9')
  const [resolution, setResolution] = useState<VideoResolution>(initial?.resolution ?? '720p')
  const [duration, setDuration] = useState(initial?.duration_seconds ?? 5)
  const [count, setCount] = useState(initial?.count ?? 1)
  const [audio, setAudio] = useState(initial?.generate_audio ?? true)
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [references, setReferences] = useState(initial?.references ?? [])
  const [picker, setPicker] = useState<{ role?: Role; mention: boolean } | null>(null)
  const [checked, setChecked] = useState<{ quote: VideoQuote; input: VideoInput } | null>(null)
  const attempt = useRef<{ payload: string; key: string } | null>(null)
  const autoRequested = useRef(false)
  const stableChoices = options.data ?? []
  const model =
    stableChoices.find((row) => row.model.id === modelId) ??
    stableChoices.find((row) => row.model.is_default) ??
    stableChoices[0]
  const modes = [...new Set(model?.profiles.map((p) => p.mode) ?? [])]
  const selectedMode = modes.includes(mode) ? mode : (modes[0] ?? 'text')
  const relevant = (role: Role) =>
    selectedMode === 'reference'
      ? role.startsWith('reference_')
      : (selectedMode === 'first_last' || selectedMode === 'first_frame') &&
        (role === 'first_frame' || (selectedMode === 'first_last' && role === 'last_frame'))
  const picked = references.filter((ref) => relevant(ref.role))
  const linkedRefs =
    selectedMode === 'reference'
      ? linked.filter((ref) => !picked.some((item) => item.file_id === ref.file_id))
      : []
  const assets = [...picked, ...linkedRefs]
  const hasVideo = assets.some(({ role }) => role === 'reference_video')
  const tuples: Choice[] = []
  for (const profile of model?.profiles.filter((p) => p.mode === selectedMode) ?? []) {
    const rates = model?.pricing.rates ?? []
    if (
      assets.filter((r) => r.role === 'reference_image').length > profile.max_images ||
      assets.filter((r) => r.role === 'reference_video').length > profile.max_videos ||
      assets.filter((r) => r.role === 'reference_audio').length > profile.max_audio ||
      (selectedMode === 'reference' && assets.length > profile.max_references)
    )
      continue
    for (const size of profile.resolutions) {
      for (const seconds of profile.durations) {
        const matches = rates.filter(
          (row) =>
            row.resolution === size &&
            (model?.pricing.mode === 'second' || row.duration_seconds === seconds),
        )
        const confirmed = matches.find((row) => row.has_video_reference === hasVideo)
        const rate =
          confirmed ??
          (selectedMode === 'reference' &&
          !hasVideo &&
          profile.max_videos > 0 &&
          assets.length < profile.max_references
            ? matches.find((row) => row.has_video_reference)
            : undefined)
        if (!rate) continue
        for (const aspect of profile.ratios) {
          tuples.push({
            ratio: aspect,
            resolution: size,
            duration: seconds,
            unit: rate.credits * (model?.pricing.mode === 'second' ? seconds : 1),
            priced: Boolean(confirmed),
            profile,
          })
        }
      }
    }
  }
  const ratios = [...new Set(tuples.map((row) => row.ratio))]
  const aspect = ratios.includes(ratio) ? ratio : ratios[0]
  const sizes = [
    ...new Set(tuples.filter((row) => row.ratio === aspect).map((row) => row.resolution)),
  ]
  const size = sizes.includes(resolution) ? resolution : sizes[0]
  const seconds = [
    ...new Set(
      tuples
        .filter((row) => row.ratio === aspect && row.resolution === size)
        .map((row) => row.duration),
    ),
  ].sort((a, b) => a - b)
  const secondsValue = seconds.includes(duration) ? duration : seconds[0]
  const chosen = tuples.find(
    (row) => row.ratio === aspect && row.resolution === size && row.duration === secondsValue,
  )
  const usableProfiles = tuples
    .filter(
      (row) => row.ratio === aspect && row.resolution === size && row.duration === secondsValue,
    )
    .map((row) => row.profile)
  const allowedRoles: Role[] =
    selectedMode === 'first_frame'
      ? ['first_frame']
      : selectedMode === 'first_last'
        ? ['first_frame', 'last_frame']
        : selectedMode === 'reference'
          ? [
              ...(usableProfiles.some(
                (p) => p.max_images > assets.filter((a) => a.role === 'reference_image').length,
              )
                ? ['reference_image' as const]
                : []),
              ...(usableProfiles.some(
                (p) => p.max_videos > assets.filter((a) => a.role === 'reference_video').length,
              )
                ? ['reference_video' as const]
                : []),
              ...(usableProfiles.some(
                (p) => p.max_audio > assets.filter((a) => a.role === 'reference_audio').length,
              )
                ? ['reference_audio' as const]
                : []),
            ]
          : []
  const assembled = [prompt, sourceText].filter(Boolean).join('\n\n')
  const unknownMention = [...assembled.matchAll(/@\[[A-Za-z0-9_-]{1,50}\]/g)].some(
    ([token]) => !assets.some((ref) => ref.token === token),
  )
  const missingAssets =
    selectedMode === 'reference'
      ? !assets.length ||
        (assets.every((asset) => asset.role === 'reference_audio') &&
          !usableProfiles.some((p) => p.allow_audio_only))
      : selectedMode === 'first_frame'
        ? !assets.some((asset) => asset.role === 'first_frame')
        : selectedMode === 'first_last' &&
          (!assets.some((asset) => asset.role === 'first_frame') ||
            !assets.some((asset) => asset.role === 'last_frame'))

  const quote = useMutation({
    mutationFn: async (input: VideoInput) => ({ quote: await quoteVideo(input), input }),
    onSuccess: setChecked,
  })
  const requestQuote = quote.mutate
  useEffect(() => {
    if (!autoQuote || !initial || autoRequested.current) return
    autoRequested.current = true
    requestQuote(initial)
  }, [autoQuote, initial, requestQuote])
  const submit = useMutation({
    mutationFn: async ({ quote, input }: { quote: VideoQuote; input: VideoInput }) => {
      const body = { ...input, confirmed_quote: quote }
      const payload = JSON.stringify(body)
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() }
      return { task: await submitVideo(body, attempt.current.key), input }
    },
    onSuccess: ({ task, input }) => {
      attempt.current = null
      setChecked(null)
      onSubmitted(task, input)
    },
    onError: (error, item) => {
      if (error instanceof ApiError && error.code === 'VIDEO_QUOTE_CHANGED') {
        setChecked(null)
        quote.mutate(item.input)
      }
    },
  })

  function mentionFor(fileId: string, role: Role) {
    const existing = references.find((ref) => ref.file_id === fileId)?.token
    if (existing) return existing
    const prefix = role.replace('reference_', '')
    let index = 1
    while (
      prompt.includes('@[' + prefix + index + ']') ||
      references.some((ref) => ref.token === '@[' + prefix + index + ']')
    )
      index++
    return '@[' + prefix + index + ']'
  }

  function addAsset(asset: VideoAsset, role: Role) {
    const token = mentionFor(asset.id, role)
    const already = references.find((ref) => ref.file_id === asset.id)
    const frame = role === 'first_frame' || role === 'last_frame'
    const withMention = picker?.mention || prompt.includes(token)
    setReferences((current) => [
      ...current.filter((ref) => ref.file_id !== asset.id && (!frame || ref.role !== role)),
      { file_id: asset.id, role, ...(withMention ? { token } : {}) },
    ])
    if (picker?.mention && !prompt.includes(token))
      setPrompt((current) =>
        current.endsWith('@')
          ? current.slice(0, -1) + token + ' '
          : current + (current ? ' ' : '') + token + ' ',
      )
    if (!picker?.mention && already?.token && !withMention)
      setPrompt((current) => current.replaceAll(already.token ?? '', ''))
    setPicker(null)
    textarea.current?.focus()
  }

  return (
    <form
      className="grid min-w-0 gap-3 rounded-2xl border border-border bg-card p-3 shadow-xs sm:p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!model || !chosen?.priced || unknownMention || missingAssets) return
        quote.mutate({
          model_id: model.model.id,
          mode: selectedMode,
          ratio: chosen.ratio,
          resolution: chosen.resolution,
          duration_seconds: chosen.duration,
          count,
          generate_audio: audio,
          prompt,
          references: assets.map(({ token, ...asset }) =>
            token && prompt.includes(token) ? { ...asset, token } : asset,
          ),
        })
      }}
    >
      <Textarea
        id={id + '-prompt'}
        ref={textarea}
        aria-label={t('video.prompt')}
        placeholder={t('video.prompt')}
        rows={4}
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value)
          if (event.target.value.endsWith('@') && allowedRoles.length) setPicker({ mention: true })
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {assets.map((ref, index) => (
          <span
            key={ref.file_id}
            className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs"
          >
            <button
              type="button"
              className="rounded focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                const token = mentionFor(ref.file_id, ref.role)
                if (!prompt.includes(token)) setPrompt((value) => value + ' ' + token + ' ')
                setReferences((value) => [
                  ...value.filter((asset) => asset.file_id !== ref.file_id),
                  { ...ref, token },
                ])
              }}
            >
              {t('video.assetLabel', { type: t('video.' + ref.role), index: index + 1 })}
            </button>
            {picked.some((item) => item.file_id === ref.file_id) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t('video.removeAsset')}
                onClick={() =>
                  setReferences((items) => items.filter((item) => item.file_id !== ref.file_id))
                }
              >
                <X />
              </Button>
            ) : null}
          </span>
        ))}
        {allowedRoles.map((role) => (
          <Button
            key={role}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPicker({ role, mention: false })}
          >
            {t('video.' + role)}
          </Button>
        ))}
        {allowedRoles.length ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('video.insertReference')}
            onClick={() => setPicker({ mention: true })}
          >
            <AtSign />
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Field id={id + '-model'} label={t('video.model')}>
          <select
            id={id + '-model'}
            className={selectClass}
            value={model?.model.id ?? ''}
            onChange={(event) => setModelId(event.target.value)}
            disabled={!model}
          >
            {!model ? (
              <option value="">{t(options.isPending ? 'common.loading' : 'video.noModels')}</option>
            ) : null}
            {stableChoices.map(({ model }) => (
              <option key={model.id} value={model.id}>
                {model.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-mode'} label={t('video.mode')}>
          <select
            id={id + '-mode'}
            className={selectClass}
            value={selectedMode}
            onChange={(event) => setMode(event.target.value as VideoInput['mode'])}
          >
            {modes.map((value) => (
              <option key={value} value={value}>
                {t('video.' + value)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-ratio'} label={t('video.ratio')}>
          <select
            id={id + '-ratio'}
            className={selectClass}
            value={aspect ?? ''}
            onChange={(event) => setRatio(event.target.value)}
          >
            {ratios.map((value) => (
              <option key={value} value={value}>
                {value === 'adaptive' ? t('video.adaptive') : value}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-size'} label={t('video.resolution')}>
          <select
            id={id + '-size'}
            className={selectClass}
            value={size ?? ''}
            onChange={(event) => setResolution(event.target.value as VideoResolution)}
          >
            {sizes.map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-seconds'} label={t('video.duration')}>
          <select
            id={id + '-seconds'}
            className={selectClass}
            value={secondsValue ?? ''}
            onChange={(event) => setDuration(Number(event.target.value))}
          >
            {seconds.map((value) => (
              <option key={value} value={value}>
                {t('video.seconds', { count: value })}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + '-count'} label={t('video.count')}>
          <select
            id={id + '-count'}
            className={selectClass}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ApiNotice
        error={
          options.error ||
          quote.error ||
          submit.error ||
          (unknownMention && new ApiError('VIDEO_REFERENCE_MISSING'))
        }
      />
      {missingAssets && model ? (
        <p className="text-sm text-muted-foreground">{t('video.needsReference')}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={audio} onCheckedChange={(value) => setAudio(value === true)} />
          {t('video.audio')}
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <output className="text-sm text-muted-foreground">
            {chosen?.priced
              ? t('video.quote', { amount: chosen.unit * count })
              : model
                ? t('video.noPrice')
                : ''}
          </output>
          <Button
            type="submit"
            disabled={
              !chosen?.priced ||
              !assembled.trim() ||
              missingAssets ||
              unknownMention ||
              quote.isPending ||
              submit.isPending
            }
          >
            <Film />
            {t('video.generate')}
          </Button>
        </div>
      </div>
      {picker ? (
        <AssetPicker
          roles={picker.role ? [picker.role] : allowedRoles}
          onClose={() => setPicker(null)}
          onSelect={addAsset}
        />
      ) : null}
      {checked ? (
        <ModalDialog
          open
          title={t('video.confirm')}
          description={
            t('video.cost', { amount: checked.quote.total_cost }) +
            ' · ' +
            t(checked.quote.pool === 'video' ? 'video.videoPool' : 'video.permanentPool')
          }
          busy={submit.isPending}
          onOpenChange={(open) => {
            if (!open) setChecked(null)
          }}
        >
          <ApiNotice error={submit.error} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submit.isPending}
              onClick={() => setChecked(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={submit.isPending}
              onClick={() => submit.mutate(checked)}
            >
              {t('video.confirm')}
            </Button>
          </div>
        </ModalDialog>
      ) : null}
    </form>
  )
}

export function AssetPicker({
  roles,
  onClose,
  onSelect,
}: {
  roles: Role[]
  onClose(): void
  onSelect(asset: VideoAsset, role: Role): void
}) {
  const { t } = useTranslation()
  const { user } = useSession()
  const client = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [selectedRole, setRole] = useState<Role | undefined>(roles[0])
  const role = selectedRole && roles.includes(selectedRole) ? selectedRole : roles[0]
  const type = role === 'reference_video' ? 'video' : role === 'reference_audio' ? 'audio' : 'image'
  const kinds = useInfiniteQuery({
    queryKey: ['user', user?.id, 'video-assets'],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => videoAPI.assets(pageParam, signal),
    getNextPageParam: (page) => page.next_cursor || undefined,
    enabled: Boolean(user),
  })
  const upload = useMutation({
    mutationFn: (asset: File) => videoAPI.upload(asset, type),
    onSuccess: (asset) => {
      void client.invalidateQueries({ queryKey: ['user', user?.id, 'video-assets'] })
      if (role) onSelect(asset, role)
    },
  })
  const available =
    kinds.data?.pages.flatMap((page) => page.items).filter((asset) => assetType(asset) === type) ??
    []
  return (
    <ModalDialog
      open
      title={t('video.chooseAsset')}
      description={t('video.assetHint')}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      busy={upload.isPending}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {roles.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={value === role ? 'default' : 'outline'}
              onClick={() => setRole(value)}
            >
              {t('video.' + value)}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!role || upload.isPending}
            onClick={() => file.current?.click()}
          >
            <Upload />
            {t('video.upload')}
          </Button>
          <input
            ref={file}
            hidden
            type="file"
            accept={
              type === 'image'
                ? 'image/png,image/jpeg,image/webp'
                : type === 'video'
                  ? 'video/mp4,video/quicktime'
                  : 'audio/mpeg,audio/wav'
            }
            onChange={(event) => {
              const asset = event.target.files?.[0]
              if (asset) upload.mutate(asset)
              event.target.value = ''
            }}
          />
        </div>
        <ApiNotice error={kinds.error || upload.error} />
        {kinds.isPending ? <p role="status">{t('common.loading')}</p> : null}
        {!kinds.isPending && !available.length ? (
          <p className="text-muted-foreground">{t('video.emptyAssets')}</p>
        ) : null}
        <div className="grid max-h-[40dvh] grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">
          {available.map((asset, index) => (
            <Button
              key={asset.id}
              type="button"
              variant="outline"
              className="h-auto min-h-14 flex-col overflow-hidden whitespace-normal p-2"
              disabled={!role}
              onClick={() => {
                if (role) onSelect(asset, role)
              }}
            >
              {type === 'image' ? (
                <img
                  alt=""
                  src={asset.url}
                  loading="lazy"
                  className="aspect-video w-full rounded object-cover"
                />
              ) : (
                <Film />
              )}
              <span>{t('video.assetLabel', { type: t('video.' + role), index: index + 1 })}</span>
            </Button>
          ))}
        </div>
        {kinds.hasNextPage ? (
          <Button type="button" variant="ghost" onClick={() => void kinds.fetchNextPage()}>
            {t('video.loadMore')}
          </Button>
        ) : null}
      </div>
    </ModalDialog>
  )
}
