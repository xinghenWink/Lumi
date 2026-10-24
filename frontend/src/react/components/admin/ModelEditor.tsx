import { useId, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { catalog } from '../../../api/catalog'
import { ApiError } from '../../../api/transport'
import {
  defaultCapabilities,
  type Capabilities,
  type ModelInput,
  type PlatformModel,
  type RouteInput,
} from '../../../api/catalog-contracts'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { modelInput } from '../../features/admin/catalog'
import { ModalDialog } from '../ui/modal-dialog'
import { Field, selectClass, textareaClass } from '../ui/field'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ApiNotice } from '../shared/ApiNotice'
import { CheckField, NumberField } from './AdminFields'

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
  const [sizes, setSizes] = useState(form.capabilities.sizes.join('\n'))
  const channels = useInfiniteQuery({
    queryKey: ['user', user?.id, 'admin-upstreams', 'choices'],
    enabled: !!user,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      catalog.channels(new URLSearchParams({ cursor: pageParam, limit: '100' }), signal),
    getNextPageParam: (page) => page.next_cursor || undefined,
    staleTime: 0,
  })
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
          sizes:
            form.type === 'image'
              ? sizes
                  .split(/[\n,]+/)
                  .map((value) => value.trim())
                  .filter(Boolean)
              : [],
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
                  const type = event.target.value === 'image' ? 'image' : 'chat',
                    capabilities = defaultCapabilities(type)
                  setForm({ ...form, type, capabilities })
                  setSizes(capabilities.sizes.join('\n'))
                }}
              >
                <option value="chat">{t('catalog.chat')}</option>
                <option value="image">{t('catalog.image')}</option>
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
            {form.type === 'chat' ? (
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
                    {(['low', 'medium', 'high'] as const).map((quality) => (
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
                </fieldset>
                <Field id={id + '-sizes'} label={t('catalog.sizes')} hint={t('catalog.sizesHint')}>
                  <textarea
                    id={id + '-sizes'}
                    className={textareaClass}
                    rows={3}
                    required
                    value={sizes}
                    onChange={(event) => setSizes(event.target.value)}
                  />
                </Field>
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
                  onChange={(supports_edit) => changeCaps({ supports_edit })}
                />
                <NumberField
                  label={t('catalog.maxReferences')}
                  value={form.capabilities.max_reference_images}
                  min={form.capabilities.supports_edit ? 1 : 0}
                  max={4}
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
