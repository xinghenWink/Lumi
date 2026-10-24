import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import { ApiError } from '../../../api/transport'
import type { RedeemBatch } from '../../../api/credit-contracts'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { createMutationKey } from '../../features/accounts/resources'
import { ModalDialog } from '../ui/modal-dialog'
import { Field, textareaClass } from '../ui/field'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ApiNotice } from '../shared/ApiNotice'

export function RedeemBatchDialog({
  onClose,
  onSaved,
}: {
  onClose(): void
  onSaved(batch: RedeemBatch): void
}) {
  const { user } = useSession(),
    { t } = useTranslation(),
    id = useId()
  const [form, setForm] = useState({
    name: '',
    note: '',
    prefix: 'LUMI',
    quantity: '100',
    credits: '',
    maxUses: '1',
    expires: '',
  })
  const [key] = useState(createMutationKey)
  const mutation = useOwnedMutation(user?.id, async (check) => {
    let expires: string | null = null
    if (form.expires) {
      const date = new Date(form.expires)
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
        throw new ApiError('INVALID_INPUT')
      expires = date.toISOString()
    }
    const body = {
      name: form.name.trim(),
      note: form.note.trim(),
      prefix: form.prefix.trim(),
      quantity: Number(form.quantity),
      credits: Number(form.credits),
      max_uses: Number(form.maxUses),
      expires_at: expires,
    }
    if (!body.name || ![body.quantity, body.credits, body.max_uses].every(Number.isSafeInteger))
      throw new ApiError('INVALID_INPUT')
    const result = await credits.createBatch(body, key.forPayload(body))
    check()
    key.complete()
    onSaved(result)
  })
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('credits.newBatch')}
      description={t('credits.batchDescription')}
      busy={mutation.isPending}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <Field id={id + '-name'} label={t('credits.batchName')}>
          <Input
            id={id + '-name'}
            value={form.name}
            required
            maxLength={80}
            disabled={mutation.isPending}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id + '-quantity'} label={t('credits.quantity')}>
            <Input
              id={id + '-quantity'}
              type="number"
              min={1}
              max={1000}
              step={1}
              required
              value={form.quantity}
              disabled={mutation.isPending}
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
            />
          </Field>
          <Field id={id + '-credits'} label={t('credits.creditsPerCode')}>
            <Input
              id={id + '-credits'}
              type="number"
              min={1}
              max={1e9}
              step={1}
              required
              value={form.credits}
              disabled={mutation.isPending}
              onChange={(event) => setForm({ ...form, credits: event.target.value })}
            />
          </Field>
          <Field id={id + '-prefix'} label={t('credits.prefix')}>
            <Input
              id={id + '-prefix'}
              value={form.prefix}
              pattern="[A-Za-z0-9]*"
              maxLength={12}
              disabled={mutation.isPending}
              onChange={(event) => setForm({ ...form, prefix: event.target.value })}
            />
          </Field>
          <Field id={id + '-uses'} label={t('credits.maxUses')} hint={t('credits.maxUsesHint')}>
            <Input
              id={id + '-uses'}
              type="number"
              min={1}
              max={1e6}
              step={1}
              required
              value={form.maxUses}
              disabled={mutation.isPending}
              onChange={(event) => setForm({ ...form, maxUses: event.target.value })}
            />
          </Field>
        </div>
        <Field id={id + '-expires'} label={t('credits.expiresAt')}>
          <Input
            id={id + '-expires'}
            type="datetime-local"
            value={form.expires}
            disabled={mutation.isPending}
            onChange={(event) => setForm({ ...form, expires: event.target.value })}
          />
        </Field>
        <Field id={id + '-note'} label={t('credits.batchNote')}>
          <textarea
            id={id + '-note'}
            className={textareaClass}
            rows={2}
            maxLength={200}
            value={form.note}
            disabled={mutation.isPending}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </Field>
        <ApiNotice error={mutation.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {t('credits.createBatch')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
