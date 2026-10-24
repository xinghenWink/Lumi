import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { operations } from '../../../api/operations'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { createMutationKey } from '../../features/accounts/resources'
import { ModalDialog } from '../ui/modal-dialog'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ApiNotice } from '../shared/ApiNotice'
export type UserBatchAction = 'enable' | 'disable' | 'grant' | 'delete'
export function UserBatchDialog({
  ids,
  action,
  onClose,
  onSaved,
}: {
  ids: string[]
  action: UserBatchAction
  onClose(): void
  onSaved(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation(),
    id = useId()
  const [amount, setAmount] = useState('1'),
    [note, setNote] = useState(''),
    [key] = useState(createMutationKey)
  const mutation = useOwnedMutation(user?.id, async (check) => {
    const body = { ids, action, amount: Number(amount), note: note.trim() }
    await operations.batchUsers(ids, action, body.amount, body.note, key.forPayload(body))
    check()
    key.complete()
    onSaved()
  })
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('ops.confirm')}
      description={t('ops.batchConfirm', { n: ids.length })}
      busy={mutation.isPending}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        {action === 'grant' ? (
          <>
            <Field id={id + '-amount'} label={t('ops.amount')}>
              <Input
                id={id + '-amount'}
                type="number"
                min={1}
                max={1e12}
                step={1}
                required
                value={amount}
                disabled={mutation.isPending}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field id={id + '-note'} label={t('ops.note')}>
              <Input
                id={id + '-note'}
                maxLength={200}
                required
                value={note}
                disabled={mutation.isPending}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </>
        ) : null}
        <ApiNotice error={mutation.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant={action === 'delete' ? 'destructive' : 'default'}
            disabled={mutation.isPending}
          >
            {t('ops.confirm')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
