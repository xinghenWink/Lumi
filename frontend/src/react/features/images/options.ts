import { useQueries, useQuery } from '@tanstack/react-query'
import type { PublicModel } from '../../../api/catalog-contracts'
import { images, type ImageConfiguration, type ImageInput } from '../../../api/images'
import { operations, type Preferences } from '../../../api/operations'
import { credits } from '../../../api/credits'
import { ApiError } from '../../../api/transport'
import { useSession } from '../auth/hooks'
import { useModels } from '../catalog/models'
import { referenceCapacity } from '../files/reference-rules'
import type { ImageDraft } from './controller'
import { useImageConfig } from './config'

export function resolveImageOptions(
  draft: ImageDraft,
  config?: ImageConfiguration,
  model?: PublicModel,
  preferences?: Preferences,
) {
  const disabledResolutions = new Set(config?.disabled_resolutions)
  const disabledRatios = new Set<string>(config?.disabled_ratios)
  const presets = config?.resolution_presets ?? []
  const modelSizes = model?.capabilities.sizes ?? []
  const inherits = model?.capabilities.use_size_presets
  const variants = presets.filter(
    (preset) =>
      !disabledRatios.has(preset.ratio) &&
      !disabledResolutions.has(preset.resolution) &&
      (inherits || modelSizes.includes(preset.size)),
  )
  const enabledSizes = new Set(variants.map((preset) => preset.size))
  const presetSizes = new Set(presets.map((preset) => preset.size))
  const explicitSizes = inherits
    ? []
    : (config?.sizes.filter(
        (size) => modelSizes.includes(size) && (!presetSizes.has(size) || enabledSizes.has(size)),
      ) ?? [])
  const sizes = [...new Set([...explicitSizes, ...enabledSizes])]
  const ratioOptions = new Map<string, string[]>()
  for (const preset of variants) {
    const options = ratioOptions.get(preset.ratio) ?? []
    options.push(preset.size)
    ratioOptions.set(preset.ratio, options)
  }
  for (const [ratio, size] of Object.entries(config?.ratio_sizes ?? {})) {
    if (inherits || !explicitSizes.includes(size) || disabledRatios.has(ratio)) continue
    // Keep custom mappings with the same ratio. Older approximate mappings remain valid over the API.
    const [w = 0, h = 0] = size.split('x').map(Number)
    const [a = 0, b = 0] = ratio.split(':').map(Number)
    const restoredMapping = draft.ratio === ratio && draft.size === size && size !== 'auto'
    if (
      !restoredMapping &&
      presets.length &&
      (!w || !h || Math.abs(w * b - h * a) > Math.max(a, b))
    )
      continue
    const options = ratioOptions.get(ratio) ?? []
    if (!options.includes(size)) options.push(size)
    ratioOptions.set(ratio, options)
  }
  const ratios = [...ratioOptions.keys()]
  const qualities = model?.capabilities.qualities ?? []
  const maxN = Math.min(config?.max_n ?? 0, model?.capabilities.max_n ?? 0)
  const maxReferences = referenceCapacity(config, model)
  const hasDraftSize = sizes.includes(draft.size)
  const preferredRatio = preferences?.image_ratio ?? ''
  const ratio =
    draft.ratio &&
    ratioOptions.has(draft.ratio) &&
    (!hasDraftSize || ratioOptions.get(draft.ratio)?.includes(draft.size))
      ? draft.ratio
      : !hasDraftSize && ratioOptions.has(preferredRatio)
        ? preferredRatio
        : !hasDraftSize && variants.length
          ? (ratios[0] ?? '')
          : ''
  const ratioSizes = ratioOptions.get(ratio) ?? []
  const size = hasDraftSize ? draft.size : (ratioSizes[0] ?? sizes[0] ?? '')
  const quality = qualities.includes(draft.quality as ImageInput['quality'])
    ? draft.quality
    : (qualities.find((quality) => quality === preferences?.image_quality) ?? qualities[0] ?? '')
  const n = maxN > 0 ? Math.max(1, Math.min(draft.n || preferences?.image_count || 1, maxN)) : 0
  const resolution = variants.find(
    (preset) => preset.ratio === ratio && preset.size === size,
  )?.resolution
  return {
    sizes,
    ratios,
    ratioOptions,
    ratioSizes,
    variants,
    resolution,
    qualities,
    maxN,
    maxReferences,
    size,
    quality,
    ratio,
    n,
  }
}
/**
 * Effective parameters and live quotes for a draft. A canvas generator passes its own
 * model ID; otherwise the shared model selection applies.
 */
export function useImageOptions(draft: ImageDraft, modelId?: string) {
  const { user } = useSession()
  const models = useModels('image')
  const model =
    (modelId ? models.items.find((item) => item.id === modelId) : undefined) ?? models.selected
  const config = useImageConfig()
  const preferences = useQuery({
    queryKey: ['user', user?.id, 'preferences'],
    enabled: !!user,
    queryFn: ({ signal }) => operations.preferences(signal),
  })
  const account = useQuery({
    queryKey: ['user', user?.id, 'credits'],
    enabled: !!user,
    queryFn: ({ signal }) => credits.account(undefined, signal),
    staleTime: 0,
  })
  const values = resolveImageOptions(draft, config.data, model, preferences.data)
  const operation = draft.references.length ? 'edit' : 'generate'
  const quotes = useQueries({
    queries: values.qualities.map((quality) => ({
      queryKey: [
        'user',
        user?.id,
        'image-quote',
        model?.id,
        operation,
        quality,
        values.size,
        values.n,
      ],
      enabled: !!user && !!model && !!values.size && values.n > 0,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        images.quote(
          {
            model_id: model?.id ?? '',
            operation,
            quality,
            size: values.size,
            count: values.n,
          },
          signal,
        ),
      retry: false,
      staleTime: 0,
    })),
  })
  const priced = values.qualities.filter((_, index) => quotes[index]?.data !== undefined)
  const quality = priced.includes(values.quality as ImageInput['quality'])
    ? values.quality
    : (priced[0] ?? '')
  const quote = quotes[values.qualities.findIndex((value) => value === quality)]?.data
  const quoteError = quotes.find(
    (query) =>
      query.error && !(query.error instanceof ApiError && query.error.code === 'PRICE_UNAVAILABLE'),
  )?.error
  return {
    ...values,
    quality,
    priced,
    quote,
    models,
    model,
    config,
    account,
    preferences,
    quoteError,
    pricing: quotes.some((query) => query.isFetching),
    error: config.error ?? models.query.error ?? account.error ?? quoteError,
  }
}
