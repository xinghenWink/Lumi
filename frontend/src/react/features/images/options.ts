import { useQueries, useQuery } from '@tanstack/react-query'
import type { PublicModel } from '../../../api/catalog-contracts'
import { images, type ImageConfiguration, type ImageInput } from '../../../api/images'
import { operations, type Preferences } from '../../../api/operations'
import { credits } from '../../../api/credits'
import { ApiError } from '../../../api/transport'
import { useSession } from '../auth/hooks'
import { useModels } from '../catalog/models'
import type { ImageDraft } from './controller'

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
  const maxReferences = model?.capabilities.supports_edit
    ? Math.min(config?.max_references ?? 0, model.capabilities.max_reference_images)
    : 0
  const savedSize = config?.ratio_sizes[preferences?.image_ratio ?? '']
  const size = sizes.includes(draft.size)
    ? draft.size
    : savedSize && sizes.includes(savedSize)
      ? savedSize
      : (sizes[0] ?? '')
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
export function useImageOptions(draft: ImageDraft) {
  const { user } = useSession()
  const models = useModels('image')
  const config = useQuery({
    queryKey: ['user', user?.id, 'image-options'],
    enabled: !!user,
    queryFn: ({ signal }) => images.options(false, signal),
  })
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
  const values = resolveImageOptions(draft, config.data, models.selected, preferences.data)
  const operation = draft.references.length ? 'edit' : 'generate'
  const quotes = useQueries({
    queries: values.qualities.map((quality) => ({
      queryKey: [
        'user',
        user?.id,
        'image-quote',
        models.selected?.id,
        operation,
        quality,
        values.size,
        values.n,
      ],
      enabled: !!user && !!models.selected && !!values.size && values.n > 0,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        images.quote(
          {
            model_id: models.selected?.id ?? '',
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
    config,
    account,
    preferences,
    quoteError,
    pricing: quotes.some((query) => query.isFetching),
    error: config.error ?? models.query.error ?? account.error ?? quoteError,
  }
}
