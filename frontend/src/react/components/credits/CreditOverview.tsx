import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gift, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import type { CreditAdjustInput } from '../../../api/credit-contracts'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useTime } from '../../features/accounts/time'
import { createMutationKey } from '../../features/accounts/resources'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { ApiNotice } from '../shared/ApiNotice'
import { Panel } from '../shared/Panel'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ModalDialog } from '../ui/modal-dialog'
import { Field, selectClass, textareaClass } from '../ui/field'

export function CreditOverview({ userId }: { userId?: string }) {
  const runtime = useRuntime(),
    { user } = useSession(),
    { t, i18n } = useTranslation(),
    time = useTime(),
    id = useId()
  const query = useQuery({
    queryKey: ['user', user?.id, 'credits', ...(userId ? [userId] : [])],
    enabled: !!user,
    queryFn: ({ signal }) => credits.account(userId, signal),
    staleTime: 0,
  })
  const [code, setCode] = useState(''),
    [notice, setNotice] = useState<{ amount?: number; adjusted?: boolean } | null>(null),
    [open, setOpen] = useState(false)
  const [form, setForm] = useState<CreditAdjustInput>({
    bucket: 'permanent',
    action: 'add',
    amount: 0,
    note: '',
  })
  const [key] = useState(createMutationKey)
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value)
  const mutation = useOwnedMutation(user?.id, async (check) => {
    const owner = runtime.session.getSnapshot().user?.id
    if (
      userId &&
      (!Number.isSafeInteger(form.amount) ||
        form.amount < 0 ||
        form.amount > 1e12 ||
        !form.note.trim())
    )
      throw new ApiError('INVALID_INPUT')
    const adjustment = { ...form, note: form.note.trim() }
    const result = userId
      ? {
          account: await credits.adjust(
            userId,
            adjustment,
            key.forPayload({ owner, userId, adjustment }),
          ),
        }
      : await credits.redeem(code.trim(), key.forPayload({ owner, code: code.trim() }))
    check()
    key.complete()
    runtime.queryClient.setQueryData(
      ['user', owner, 'credits', ...(userId ? [userId] : [])],
      result.account,
    )
    if (!userId) setCode('')
    setNotice('credits' in result ? { amount: result.credits } : { adjusted: true })
    setOpen(false)
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', owner, 'credits'] })
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', owner, 'credit-ledger'] })
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', owner, 'credit-usage'] })
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', owner, 'admin-users'] })
    void runtime.queryClient.invalidateQueries({
      queryKey: ['user', owner, 'redemption-records'],
    })
  })
  return (
    <Panel title={t('credits.overview')} className="credit-overview">
      <ApiNotice error={query.error} />
      {query.data ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs text-muted-foreground">{t('credits.total')}</span>
              <p className="mt-1 flex flex-wrap items-baseline gap-2">
                <strong
                  data-testid="credit-total"
                  className="break-all text-4xl font-semibold tracking-tight"
                >
                  {number(query.data.total)}
                </strong>
                <span className="text-xs text-muted-foreground">{t('credits.unit')}</span>
              </p>
            </div>
            {userId ? (
              <Button
                size="sm"
                onClick={() => {
                  mutation.reset()
                  setNotice(null)
                  setOpen(true)
                }}
              >
                {t('credits.adjust')}
              </Button>
            ) : (
              <Wallet size={28} className="text-primary/40" />
            )}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
            {[
              { key: 'daily', value: query.data.daily_balance, icon: Gift },
              { key: 'permanent', value: query.data.permanent_balance, icon: Wallet },
            ].map(({ key, value, icon: Icon }) => (
              <div key={key}>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon size={14} />
                  {t('credits.' + key)}
                </span>
                <strong
                  data-testid={key + '-balance'}
                  className="mt-2 block break-all text-xl font-semibold"
                >
                  {number(value)}
                </strong>
                <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                  {t('credits.' + key + 'Hint')}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[10px] leading-5 text-muted-foreground">
            {t('credits.resetAt', { time: time(query.data.next_reset_at) })}
            <br />
            {t('credits.timezone', { zone: query.data.timezone })}
          </p>
        </>
      ) : query.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.retry')}
        </Button>
      ) : (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          {t('credits.loading')}
        </p>
      )}
      {!userId ? (
        <form
          className="mt-5 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault()
            setNotice(null)
            mutation.mutate()
          }}
        >
          <Field id={id + '-code'} label={t('credits.redeem')} hint={t('credits.redeemHint')}>
            <div className="flex flex-wrap gap-2">
              <Input
                id={id + '-code'}
                className="min-w-32 flex-1"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={80}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={t('credits.codePlaceholder')}
                disabled={mutation.isPending}
                required
              />
              <Button type="submit" disabled={mutation.isPending || !code.trim()}>
                {t('credits.redeemAction')}
              </Button>
            </div>
          </Field>
        </form>
      ) : null}
      {!open ? <ApiNotice error={mutation.error} /> : null}
      {notice ? (
        <p role="status" className="mt-3 text-xs text-primary">
          {t(notice.adjusted ? 'credits.adjusted' : 'credits.redeemSuccess', {
            amount: number(notice.amount ?? 0),
          })}
        </p>
      ) : null}
      <ModalDialog
        open={open}
        onOpenChange={setOpen}
        title={t('credits.adjust')}
        description={t('credits.adjustDescription')}
        busy={mutation.isPending}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field id={id + '-bucket'} label={t('credits.bucket')}>
              <select
                id={id + '-bucket'}
                className={selectClass}
                value={form.bucket}
                onChange={(event) =>
                  setForm({
                    ...form,
                    bucket: event.target.value === 'daily' ? 'daily' : 'permanent',
                  })
                }
              >
                {['permanent', 'daily'].map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {t('credits.' + bucket)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={id + '-action'} label={t('credits.action')}>
              <select
                id={id + '-action'}
                className={selectClass}
                value={form.action}
                onChange={(event) => {
                  const action = event.target.value
                  if (action === 'add' || action === 'subtract' || action === 'set')
                    setForm({ ...form, action })
                }}
              >
                {['add', 'subtract', 'set'].map((action) => (
                  <option key={action} value={action}>
                    {t('credits.' + action)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field id={id + '-amount'} label={t('credits.amount')}>
            <Input
              id={id + '-amount'}
              type="number"
              min={0}
              max={1e12}
              step={1}
              value={form.amount}
              required
              onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })}
            />
          </Field>
          <Field id={id + '-note'} label={t('credits.note')}>
            <textarea
              id={id + '-note'}
              className={textareaClass}
              rows={3}
              maxLength={200}
              required
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </Field>
          <ApiNotice error={mutation.error} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t('credits.adjustAction')}
            </Button>
          </div>
        </form>
      </ModalDialog>
    </Panel>
  )
}
