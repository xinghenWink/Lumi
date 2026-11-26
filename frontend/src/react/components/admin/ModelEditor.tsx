import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { catalog } from '../../../api/catalog'
import { imageQualities } from '../../../api/image-quality'
import { ApiError } from '../../../api/transport'
import { imageResolutions } from '../../../api/image-resolutions'
import {
  defaultCapabilities,
  type Capabilities,
  type ModelInput,
  type PlatformModel,
  type RouteInput,
} from '../../../api/catalog-contracts'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { modelInput, useChannelChoices } from '../../features/admin/catalog'
import { ModalDialog } from '../ui/modal-dialog'
import { Field, selectClass, textareaClass } from '../ui/field'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'
import { ApiNotice } from '../shared/ApiNotice'
import { CheckField, NumberField, unboundedCount } from './AdminFields'
import { SizePicker } from './SizePicker'
import { VideoBinding, VideoCapabilitiesEditor } from './VideoCapabilities'

export function ModelEditor({
  model,
  onClose,
  onSaved,
}: {
  model: PlatformModel | null
  onClose(): void
  onSaved(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation(),
    id = useId()
  const [form, setForm] = useState<ModelInput>(() =>
    model
      ? modelInput(model)
      : {
          version: 0,
          display_name: '',
          type: 'chat',
          description: '',
          icon: '',
          sort_order: 0,
          enabled: false,
          is_default: false,
          capabilities: defaultCapabilities('chat'),
          routes: [],
        },
  )
  const channels = useChannelChoices(user?.id)
  const choices = new Map(
    model?.routes.map((route) => [route.upstream_id, route.upstream_name]) ?? [],
  )
  for (const row of channels.data?.pages.flatMap((page) => page.items) ?? [])
    choices.set(row.id, row.name)
  const changeCaps = (patch: Partial<Capabilities>) =>
    setForm({ ...form, capabilities: { ...form.capabilities, ...patch } })
  const changeRoute = (index: number, patch: Partial<RouteInput>) =>
    setForm({
      ...form,
      routes: form.routes.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    })
  const resolutions = form.capabilities.supported_resolutions ?? imageResolutions
  const mutation = useOwnedMutation(user?.id, async (check) => {
    if (
      !form.display_name.trim() ||
      form.routes.some((route) => !route.upstream_id || !route.upstream_model_name.trim())
    )
      throw new ApiError('INVALID_INPUT')
    await catalog.saveModel(
      {
        ...form,
        display_name: form.display_name.trim(),
        capabilities: {
          ...form.capabilities,
          sizes: form.type === 'image' ? form.capabilities.sizes : [],
        },
        routes: form.routes.map((route) => ({
          ...route,
          upstream_model_name: route.upstream_model_name.trim(),
        })),
      },
      model?.id,
    )
    check()
    onSaved()
  })
  return (
    <ModalDialog
      open
      wide
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t(model ? 'catalog.editModel' : 'catalog.newModel')}
      description={t('catalog.modelFormHint')}
      busy={mutation.isPending}
    >
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <fieldset className="grid min-w-0 gap-5" disabled={mutation.isPending}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id + '-name'} label={t('catalog.modelName')}>
              <Input
                id={id + '-name'}
                value={form.display_name}
                maxLength={80}
                required
                onChange={(event) => setForm({ ...form, display_name: event.target.value })}
              />
            </Field>
            <Field id={id + '-kind'} label={t('catalog.type')}>
              <select
                id={id + '-kind'}
                value={form.type}
                disabled={!!model}
                className={selectClass}
                onChange={(event) => {
                  const type =
                      event.target.value === 'video'
                        ? 'video'
                        : event.target.value === 'image'
                          ? 'image'
                          : 'chat',
                    capabilities: Capabilities = {
                      ...defaultCapabilities(type),
                      ...(type === 'image'
                        ? { use_size_presets: true, supported_resolutions: ['1k'] }
                        : {}),
                    }
                  setForm({ ...form, type, capabilities })
                }}
              >
                <option value="chat">{t('catalog.chat')}</option>
                <option value="image">{t('catalog.image')}</option>
                <option value="video">{t('video.short')}</option>
              </select>
            </Field>
          </div>
          <Field id={id + '-description'} label={t('catalog.description')}>
            <textarea
              id={id + '-description'}
              className={textareaClass}
              value={form.description}
              rows={2}
              maxLength={500}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id + '-icon'} label={t('catalog.icon')}>
              <Input
                id={id + '-icon'}
                value={form.icon}
                maxLength={40}
                onChange={(event) => setForm({ ...form, icon: event.target.value })}
              />
            </Field>
            <NumberField
              label={t('catalog.sortOrder')}
              value={form.sort_order}
              max={10000}
              onChange={(sort_order) => setForm({ ...form, sort_order })}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <CheckField
              label={t('catalog.enabled')}
              checked={form.enabled}
              onChange={(enabled) =>
                setForm({ ...form, enabled, is_default: enabled && form.is_default })
              }
            />
            <CheckField
              label={t('catalog.default')}
              checked={form.is_default}
              disabled={!form.enabled}
              onChange={(is_default) => setForm({ ...form, is_default })}
            />
          </div>
          <section className="space-y-4 rounded-xl border border-border p-4">
            <h2 className="font-semibold">{t('catalog.capabilities')}</h2>
            {form.type === 'video' ? (
              <VideoCapabilitiesEditor
                profiles={form.capabilities.video?.profiles ?? []}
                change={(profiles) => changeCaps({ video: { profiles } })}
              />
            ) : form.type === 'chat' ? (
              <>
                <div className="flex flex-wrap gap-6">
                  <CheckField
                    label={t('catalog.stream')}
                    checked={form.capabilities.stream}
                    onChange={(stream) => changeCaps({ stream })}
                  />
                  <CheckField
                    label={t('catalog.vision')}
                    checked={form.capabilities.vision}
                    onChange={(vision) => changeCaps({ vision })}
                  />
                  <CheckField
                    label={t('catalog.reasoningEffort')}
                    checked={form.capabilities.reasoning_effort === true}
                    onChange={(reasoning_effort) => changeCaps({ reasoning_effort })}
                  />
                </div>
                <NumberField
                  label={t('catalog.maxContext')}
                  value={form.capabilities.max_context_tokens}
                  min={1}
                  max={1000000}
                  onChange={(max_context_tokens) => changeCaps({ max_context_tokens })}
                />
              </>
            ) : (
              <>
                <fieldset>
                  <legend className="text-xs text-muted-foreground">
                    {t('catalog.qualities')}
                  </legend>
                  <div className="flex flex-wrap gap-6">
                    {imageQualities.map((quality) => (
                      <CheckField
                        key={quality}
                        label={t(`credits.${quality}`)}
                        checked={form.capabilities.qualities.includes(quality)}
                        onChange={(selected) =>
                          changeCaps({
                            qualities: selected
                              ? [...form.capabilities.qualities, quality]
                              : form.capabilities.qualities.filter((value) => value !== quality),
                          })
                        }
                      />
                    ))}
                  </div>
                  {form.capabilities.qualities.some(
                    (quality) => quality === 'xhigh' || quality === 'max',
                  ) && (
                    <p className="text-xs text-muted-foreground">
                      {t('catalog.advancedQualityPricing')}
                    </p>
                  )}
                </fieldset>
                <fieldset aria-describedby={id + '-resolutions-hint'}>
                  <legend className="text-xs text-muted-foreground">
                    {t('images.supportedResolutions')}
                  </legend>
                  <div className="flex flex-wrap gap-x-6">
                    {imageResolutions.map((resolution) => {
                      const checked = resolutions.includes(resolution)
                      const key = id + '-resolution-' + resolution
                      return (
                        <Label key={resolution} htmlFor={key} className="min-h-10 gap-3 text-sm">
                          <Checkbox
                            id={key}
                            checked={checked}
                            disabled={mutation.isPending || (checked && resolutions.length === 1)}
                            onCheckedChange={(selected) =>
                              changeCaps({
                                supported_resolutions:
                                  selected === true
                                    ? imageResolutions.filter(
                                        (tier) => tier === resolution || resolutions.includes(tier),
                                      )
                                    : resolutions.filter((tier) => tier !== resolution),
                              })
                            }
                          />
                          {t('images.resolutionTier.' + resolution)}
                        </Label>
                      )
                    })}
                  </div>
                  <p id={id + '-resolutions-hint'} className="text-xs text-muted-foreground">
                    {t('images.supportedResolutionsHint')}
                  </p>
                </fieldset>
                <CheckField
                  role="switch"
                  label={t('images.useSizePresets')}
                  checked={form.capabilities.use_size_presets ?? false}
                  onChange={(use_size_presets) => changeCaps({ use_size_presets })}
                />
                {form.capabilities.use_size_presets ? (
                  <p className="text-xs text-muted-foreground">{t('images.modelPresetHint')}</p>
                ) : (
                  <SizePicker
                    value={form.capabilities.sizes}
                    onChange={(sizes) => changeCaps({ sizes })}
                  />
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label={t('catalog.maxN')}
                    value={form.capabilities.max_n}
                    min={1}
                    max={10}
                    onChange={(max_n) => changeCaps({ max_n })}
                  />
                  <Field id={id + '-format'} label={t('catalog.responseFormat')}>
                    <select
                      id={id + '-format'}
                      className={selectClass}
                      value={form.capabilities.response_format}
                      onChange={(event) =>
                        changeCaps({
                          response_format: event.target.value === 'url' ? 'url' : 'b64_json',
                        })
                      }
                    >
                      <option value="b64_json">{t('catalog.base64')}</option>
                      <option value="url">{t('catalog.url')}</option>
                    </select>
                  </Field>
                </div>
                <CheckField
                  label={t('catalog.supportsEdit')}
                  checked={form.capabilities.supports_edit}
                  onChange={(supports_edit) =>
                    changeCaps(
                      supports_edit
                        ? { supports_edit }
                        : { supports_edit, supports_transparent_background: false },
                    )
                  }
                />
                <CheckField
                  label={t('catalog.supportsTransparentBackground')}
                  checked={form.capabilities.supports_transparent_background ?? false}
                  disabled={!form.capabilities.supports_edit}
                  onChange={(supports_transparent_background) =>
                    changeCaps({ supports_transparent_background })
                  }
                />
                <CheckField
                  label={t('catalog.supportsGif')}
                  checked={form.capabilities.supports_gif ?? false}
                  onChange={(supports_gif) => changeCaps({ supports_gif })}
                />
                <CheckField
                  label={t('catalog.supportsComplexity')}
                  checked={form.capabilities.supports_complexity ?? false}
                  onChange={(supports_complexity) => changeCaps({ supports_complexity })}
                />
                <NumberField
                  label={t('catalog.maxReferences')}
                  value={form.capabilities.max_reference_images}
                  min={form.capabilities.supports_edit ? 1 : 0}
                  max={unboundedCount}
                  onChange={(max_reference_images) => changeCaps({ max_reference_images })}
                />
              </>
            )}
          </section>
          <section className="space-y-4 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{t('catalog.routes')}</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={form.routes.length >= 20}
                onClick={() =>
                  setForm({
                    ...form,
                    routes: [
                      ...form.routes,
                      {
                        upstream_id: choices.keys().next().value ?? '',
                        upstream_model_name: '',
                        priority: 0,
                        weight: 1,
                        enabled: true,
                      },
                    ],
                  })
                }
              >
                <Plus size={14} />
                {t('catalog.addRoute')}
              </Button>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">{t('catalog.routesHint')}</p>
            <ApiNotice error={channels.error} />
            {channels.isError ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void channels.refetch()
                }}
              >
                {t('common.retry')}
              </Button>
            ) : null}
            {!form.routes.length ? (
              <p className="text-xs text-muted-foreground">{t('catalog.noRoutes')}</p>
            ) : null}
            {form.routes.map((route, index) => (
              <div key={index} className="space-y-3 rounded-xl bg-muted/40 p-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={id + '-channel-' + index} label={t('catalog.channel')}>
                    <select
                      id={id + '-channel-' + index}
                      aria-label={t('catalog.channel') + ' ' + (index + 1)}
                      className={selectClass}
                      required
                      value={route.upstream_id}
                      onChange={(event) => changeRoute(index, { upstream_id: event.target.value })}
                    >
                      <option value="">{t('catalog.chooseChannel')}</option>
                      {[...choices].map(([value, name]) => (
                        <option key={value} value={value}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={id + '-remote-' + index} label={t('catalog.remoteModel')}>
                    <Input
                      id={id + '-remote-' + index}
                      aria-label={t('catalog.remoteModel') + ' ' + (index + 1)}
                      value={route.upstream_model_name}
                      required
                      maxLength={200}
                      onChange={(event) =>
                        changeRoute(index, { upstream_model_name: event.target.value })
                      }
                    />
                  </Field>
                </div>
                {form.type === 'video' ? (
                  <>
                    <VideoBinding
                      {...(route.video_protocol === undefined
                        ? {}
                        : { protocol: route.video_protocol })}
                      {...(route.video_profile === undefined
                        ? {}
                        : { profile: route.video_profile })}
                      change={(video_protocol, video_profile) =>
                        changeRoute(index, { video_protocol, video_profile })
                      }
                    />
                    <CheckField
                      label={t('video.useOverride')}
                      checked={!!route.video_capabilities}
                      onChange={(enabled) => {
                        if (enabled)
                          changeRoute(index, {
                            video_capabilities: structuredClone(
                              form.capabilities.video ?? { profiles: [] },
                            ),
                          })
                        else
                          setForm({
                            ...form,
                            routes: form.routes.map((item, i) => {
                              if (i !== index) return item
                              const { video_capabilities: previous, ...remaining } = item
                              return previous ? remaining : item
                            }),
                          })
                      }}
                    />
                    {route.video_capabilities ? (
                      <VideoCapabilitiesEditor
                        profiles={route.video_capabilities.profiles}
                        change={(profiles) =>
                          changeRoute(index, { video_capabilities: { profiles } })
                        }
                      />
                    ) : null}
                  </>
                ) : null}
                <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                  <NumberField
                    label={t('catalog.priority')}
                    value={route.priority}
                    max={10000}
                    onChange={(priority) => changeRoute(index, { priority })}
                  />
                  <NumberField
                    label={t('catalog.weight')}
                    value={route.weight}
                    min={1}
                    max={10000}
                    onChange={(weight) => changeRoute(index, { weight })}
                  />
                  <CheckField
                    label={t('catalog.enabled') + ' ' + t('catalog.routes') + ' ' + (index + 1)}
                    checked={route.enabled}
                    onChange={(enabled) => changeRoute(index, { enabled })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={t('catalog.removeRoute') + ' ' + (index + 1)}
                    onClick={() =>
                      setForm({ ...form, routes: form.routes.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            ))}
            {channels.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                disabled={channels.isFetchingNextPage}
                onClick={() => {
                  void channels.fetchNextPage()
                }}
              >
                {t('catalog.moreChannels')}
              </Button>
            ) : null}
          </section>
        </fieldset>
        <ApiNotice error={mutation.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {t('catalog.saveModel')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
