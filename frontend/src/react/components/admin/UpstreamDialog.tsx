import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { catalog } from '../../../api/catalog'
import { ApiError } from '../../../api/transport'
import type { Upstream, UpstreamInput } from '../../../api/catalog-contracts'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { upstreamInput } from '../../features/admin/catalog'
import { ModalDialog } from '../ui/modal-dialog'
import { Field, selectClass, textareaClass } from '../ui/field'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ApiNotice } from '../shared/ApiNotice'
import { CheckField, NumberField } from './AdminFields'

export function UpstreamDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Upstream | null
  onClose(): void
  onSaved(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation(),
    id = useId(),
    keyInput = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<UpstreamInput>(() =>
    row
      ? upstreamInput(row)
      : {
          version: 0,
          name: '',
          base_url: '',
          timeout_chat_s: 120,
          timeout_image_s: 180,
          proxy_url: '',
          enabled: true,
          priority: 0,
          weight: 1,
          edit_format: 'multipart',
          note: '',
        },
  )
  const [clearKey, setClearKey] = useState(false)
  const mutation = useOwnedMutation(user?.id, async (check) => {
    const key = keyInput.current?.value.trim() ?? ''
    if (!form.name.trim() || !form.base_url.trim() || (!row && !key) || (clearKey && form.enabled))
      throw new ApiError('INVALID_INPUT')
    await catalog.saveChannel(
      {
        ...form,
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        api_key: clearKey ? '' : key || null,
      },
      row?.id,
    )
    check()
    if (keyInput.current) keyInput.current.value = ''
    onSaved()
  })
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t(row ? 'catalog.editChannel' : 'catalog.newChannel')}
      description={t('catalog.channelFormHint')}
      busy={mutation.isPending}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-4">
          <Field id={id + '-name'} label={t('catalog.channelName')}>
            <Input
              id={id + '-name'}
              value={form.name}
              maxLength={80}
              required
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field id={id + '-url'} label={t('catalog.baseURL')}>
            <Input
              id={id + '-url'}
              type="url"
              value={form.base_url}
              required
              placeholder={t('catalog.basePlaceholder')}
              onChange={(event) => setForm({ ...form, base_url: event.target.value })}
            />
          </Field>
          <Field id={id + '-key'} label={t('catalog.apiKey')}>
            <Input
              id={id + '-key'}
              ref={keyInput}
              type="password"
              autoComplete="new-password"
              maxLength={4096}
              required={!row}
              disabled={clearKey}
              placeholder={t('catalog.keyPlaceholder')}
            />
          </Field>
          {row?.api_key_configured ? (
            <CheckField
              label={t('catalog.clearKey')}
              checked={clearKey}
              disabled={form.enabled}
              onChange={setClearKey}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('catalog.chatTimeout')}
              value={form.timeout_chat_s}
              min={1}
              max={600}
              onChange={(value) => setForm({ ...form, timeout_chat_s: value })}
            />
            <NumberField
              label={t('catalog.imageTimeout')}
              value={form.timeout_image_s}
              min={1}
              max={600}
              onChange={(value) => setForm({ ...form, timeout_image_s: value })}
            />
          </div>
          <Field id={id + '-proxy'} label={t('catalog.proxyURL')} hint={t('catalog.proxyHint')}>
            <Input
              id={id + '-proxy'}
              type="url"
              value={form.proxy_url}
              onChange={(event) => setForm({ ...form, proxy_url: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              label={t('catalog.priority')}
              value={form.priority}
              max={10000}
              onChange={(value) => setForm({ ...form, priority: value })}
            />
            <NumberField
              label={t('catalog.weight')}
              value={form.weight}
              min={1}
              max={10000}
              onChange={(value) => setForm({ ...form, weight: value })}
            />
          </div>
          <Field id={id + '-format'} label={t('catalog.editFormat')}>
            <select
              id={id + '-format'}
              className={selectClass}
              value={form.edit_format}
              onChange={(event) =>
                setForm({
                  ...form,
                  edit_format: event.target.value === 'json' ? 'json' : 'multipart',
                })
              }
            >
              <option value="multipart">{t('catalog.multipart')}</option>
              <option value="json">{t('catalog.json')}</option>
            </select>
          </Field>
          <Field id={id + '-note'} label={t('catalog.note')}>
            <textarea
              id={id + '-note'}
              className={textareaClass}
              rows={2}
              maxLength={500}
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </Field>
          <CheckField
            label={t('catalog.enabled')}
            checked={form.enabled}
            onChange={(enabled) => {
              setForm({ ...form, enabled })
              if (enabled) setClearKey(false)
            }}
          />
        </fieldset>
        <ApiNotice error={mutation.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {t('catalog.saveChannel')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
