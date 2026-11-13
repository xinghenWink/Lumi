import { describe, expect, it } from 'vitest'
import { defaultCapabilities, type PublicModel } from '../../../api/catalog-contracts'
import type { ImageConfiguration } from '../../../api/images'
import type { Preferences } from '../../../api/operations'
import { emptyImageDraft } from './controller'
import { resolveImageOptions } from './options'
const config: ImageConfiguration = {
  max_n: 3,
  max_references: 2,
  max_upload_bytes: 1234,
  sizes: ['small', 'large'],
  ratio_sizes: { '1:1': 'small', '2:1': 'large' },
  per_user_concurrency: 1,
  global_concurrency: 2,
  timeout_seconds: 30,
  queue_timeout_seconds: 60,
  split_requests: false,
  retention_days: 0,
  admin_can_view_content: false,
  version: 1,
}
const model: PublicModel = {
  id: 'm',
  display_name: 'Server model',
  type: 'image',
  description: '',
  icon: '',
  sort_order: 0,
  is_default: true,
  capabilities: {
    ...defaultCapabilities('image'),
    sizes: ['large'],
    qualities: ['high'],
    max_n: 2,
    supports_edit: true,
    max_reference_images: 4,
  },
}
describe('server-derived image options', () => {
  it('does not invent dimensions, capabilities or defaults while backend data is unavailable', () => {
    expect(resolveImageOptions(emptyImageDraft)).toMatchObject({
      size: '',
      quality: '',
      n: 0,
      maxReferences: 0,
      sizes: [],
    })
  })
  it('intersects both contracts and replaces obsolete parameters with supported backend values', () => {
    expect(
      resolveImageOptions(
        { ...emptyImageDraft, size: 'obsolete', quality: 'low', n: 8 },
        config,
        model,
      ),
    ).toMatchObject({
      size: 'large',
      quality: 'high',
      n: 2,
      maxReferences: 2,
      ratios: [['2:1', 'large']],
    })
    expect(
      resolveImageOptions(emptyImageDraft, config, {
        ...model,
        capabilities: { ...model.capabilities, supports_edit: false },
      }).maxReferences,
    ).toBe(0)
  })
  it('maps a ratio-only draft to its configured size and ignores unavailable ratios', () => {
    const both = { ...model, capabilities: { ...model.capabilities, sizes: ['small', 'large'] } }
    const preferences: Preferences = {
      theme: 'system',
      instructions: '',
      image_quality: 'high',
      image_ratio: '1:1',
      image_count: 1,
    }
    expect(
      resolveImageOptions({ ...emptyImageDraft, ratio: '2:1' }, config, both, preferences),
    ).toMatchObject({ size: 'large', ratio: '2:1' })
    expect(
      resolveImageOptions({ ...emptyImageDraft, ratio: '16:9' }, config, both, preferences),
    ).toMatchObject({ size: 'small', ratio: '1:1' })
    expect(
      resolveImageOptions({ ...emptyImageDraft, ratio: '2:1', size: 'small' }, config, both),
    ).toMatchObject({ size: 'small', ratio: '' })
  })
})
