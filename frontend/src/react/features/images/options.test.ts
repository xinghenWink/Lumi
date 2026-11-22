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
  it('keeps planning optional and scoped to the supported model', () => {
    const enabled = { ...model, capabilities: { ...model.capabilities, supports_complexity: true } }
    const choice = { ...emptyImageDraft, complexity: 'high' as const, complexityModelId: model.id }
    expect(resolveImageOptions(emptyImageDraft, config, enabled)).toMatchObject({
      supportsComplexity: true,
      complexity: undefined,
    })
    expect(resolveImageOptions(choice, config, enabled).complexity).toBe('high')
    expect(
      resolveImageOptions(choice, config, { ...enabled, id: 'other' }).complexity,
    ).toBeUndefined()
    expect(resolveImageOptions(choice, config, model)).toMatchObject({
      supportsComplexity: false,
      complexity: undefined,
    })
  })
  it('defaults to auto when available and retains valid explicit sizes and preferences', () => {
    const configured: ImageConfiguration = {
      ...config,
      sizes: ['1024x1024', 'auto'],
      resolution_presets: [{ ratio: '1:1', resolution: '1k', size: '1024x1024' }],
    }
    const explicit = { ...model, capabilities: { ...model.capabilities, sizes: configured.sizes } }
    const inherited = { ...model, capabilities: { ...model.capabilities, use_size_presets: true } }
    const preferences: Preferences = {
      theme: 'system',
      instructions: '',
      image_quality: 'high',
      image_ratio: '1:1',
      image_count: 1,
    }
    for (const options of [
      resolveImageOptions(emptyImageDraft, configured, explicit),
      resolveImageOptions(emptyImageDraft, { ...configured, sizes: ['1024x1024'] }, inherited),
      resolveImageOptions({ ...emptyImageDraft, size: 'auto' }, configured, explicit, preferences),
    ]) {
      expect(options).toMatchObject({
        ratios: ['auto', '1:1'],
        size: 'auto',
        ratio: 'auto',
        ratioSizes: ['auto'],
        resolution: undefined,
      })
    }
    expect(resolveImageOptions(emptyImageDraft, configured, explicit, preferences)).toMatchObject({
      ratio: '1:1',
      size: '1024x1024',
    })
    expect(
      resolveImageOptions({ ...emptyImageDraft, size: '1024x1024' }, configured, explicit),
    ).toMatchObject({
      ratio: '',
      size: '1024x1024',
    })
    const fixedOnly = {
      ...explicit,
      capabilities: { ...explicit.capabilities, sizes: ['1024x1024'] },
    }
    for (const options of [
      resolveImageOptions(emptyImageDraft, { ...configured, disabled_ratios: ['auto'] }, inherited),
      resolveImageOptions(emptyImageDraft, { ...configured, sizes: ['1024x1024'] }, explicit),
      resolveImageOptions(emptyImageDraft, configured, fixedOnly, {
        ...preferences,
        image_ratio: 'auto',
      }),
    ]) {
      expect(options).toMatchObject({ ratios: ['1:1'], ratio: '1:1', size: '1024x1024' })
    }
  })

  it('keeps the exact draft size and lists only available resolutions for its ratio', () => {
    const configured: ImageConfiguration = {
      ...config,
      sizes: ['1024x1024', '1536x1024'],
      ratio_sizes: { '16:9': '1536x1024' },
      resolution_presets: [
        { ratio: '1:1', resolution: '1k', size: '1024x1024' },
        { ratio: '16:9', resolution: '1k', size: '1280x720' },
        { ratio: '16:9', resolution: '2k', size: '2048x1152' },
        { ratio: '16:9', resolution: '4k', size: '3840x2160' },
      ],
      disabled_resolutions: ['4k'],
    }
    const inherited = { ...model, capabilities: { ...model.capabilities, use_size_presets: true } }
    expect(
      resolveImageOptions(
        { ...emptyImageDraft, ratio: '16:9', size: '2048x1152' },
        configured,
        inherited,
      ),
    ).toMatchObject({
      ratio: '16:9',
      resolution: '2k',
      size: '2048x1152',
      ratioSizes: ['1280x720', '2048x1152'],
    })
    const explicit = {
      ...model,
      capabilities: { ...model.capabilities, sizes: ['1536x1024', '1280x720'] },
    }
    expect(
      resolveImageOptions({ ...emptyImageDraft, ratio: '16:9' }, configured, explicit),
    ).toMatchObject({
      size: '1280x720',
      ratioSizes: ['1280x720'],
    })
    expect(
      resolveImageOptions(
        { ...emptyImageDraft, ratio: '16:9', size: '3840x2160' },
        { ...configured, disabled_ratios: ['auto', '16:9'] },
        inherited,
      ),
    ).toMatchObject({ ratio: '1:1', resolution: '1k', size: '1024x1024' })
  })
  it('filters both preset and explicit tiers and replaces an invalid size within the same ratio', () => {
    const configuration: ImageConfiguration = {
      ...config,
      sizes: ['2560x1440', '2561x1440', 'auto'],
      ratio_sizes: {},
      resolution_presets: [
        { ratio: '16:9', resolution: '1k', size: '1280x720' },
        { ratio: '16:9', resolution: '2k', size: '2048x1152' },
        { ratio: '16:9', resolution: '4k', size: '3840x2160' },
        { ratio: '1:1', resolution: '1k', size: '1024x1024' },
      ],
    }
    const restricted: PublicModel = {
      ...model,
      capabilities: {
        ...model.capabilities,
        supported_resolutions: ['1k', '2k'],
        sizes: [...configuration.sizes, '3840x2160', '2048x1152'],
        use_size_presets: true,
      },
    }
    const draft = { ...emptyImageDraft, size: '3840x2160', ratio: '16:9' }
    expect(resolveImageOptions(draft, configuration, restricted)).toMatchObject({
      size: '1280x720',
      ratio: '16:9',
      ratioSizes: ['1280x720', '2048x1152'],
    })
    const explicit = {
      ...restricted,
      capabilities: { ...restricted.capabilities, use_size_presets: false },
    }
    expect(resolveImageOptions(draft, configuration, explicit)).toMatchObject({
      sizes: ['2560x1440', '2048x1152', 'auto'],
      size: '2048x1152',
    })
    const fixedOnly = {
      ...explicit,
      capabilities: { ...explicit.capabilities, sizes: ['3840x2160', '2561x1440'] },
    }
    expect(resolveImageOptions(draft, configuration, fixedOnly)).toMatchObject({
      sizes: [],
      size: '',
    })
  })

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
      ratios: ['2:1'],
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
