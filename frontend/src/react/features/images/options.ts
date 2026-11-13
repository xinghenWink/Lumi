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
  const sizes = config?.sizes.filter((size) => model?.capabilities.sizes.includes(size)) ?? []
  const ratios = Object.entries(config?.ratio_sizes ?? {}).filter(([, size]) =>
    sizes.includes(size),
  )
  const qualities = model?.capabilities.qualities ?? []
  const maxN = Math.min(config?.max_n ?? 0, model?.capabilities.max_n ?? 0)
  const maxReferences = referenceCapacity(config, model)
  const savedSize = config?.ratio_sizes[preferences?.image_ratio ?? '']
  // A draft may name only a ratio (a chat illustration); the configured mapping then picks its size.
  const ratioSize = draft.size ? undefined : ratios.find(([ratio]) => ratio === draft.ratio)?.[1]
  const size = sizes.includes(draft.size)
    ? draft.size
    : (ratioSize ?? (savedSize && sizes.includes(savedSize) ? savedSize : (sizes[0] ?? '')))
  const quality = qualities.includes(draft.quality as ImageInput['quality'])
    ? draft.quality
    : (qualities.find((quality) => quality === preferences?.image_quality) ?? qualities[0] ?? '')
  const ratio = ratios.some(([ratio, mapped]) => ratio === draft.ratio && mapped === size)
    ? draft.ratio
    : !draft.size &&
        ratios.some(([ratio, mapped]) => ratio === preferences?.image_ratio && mapped === size)
      ? (preferences?.image_ratio ?? '')
      : ''
  const n = maxN > 0 ? Math.max(1, Math.min(draft.n || preferences?.image_count || 1, maxN)) : 0
  return { sizes, ratios, qualities, maxN, maxReferences, size, quality, ratio, n }
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
