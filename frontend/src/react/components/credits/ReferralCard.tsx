import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import { useRuntime } from '../../app/context'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Field } from '../ui/field'
import { Input } from '../ui/input'

export function ReferralCard() {
  const { t } = useTranslation()
  const { user } = useSession()
  const { queryClient } = useRuntime()
  const id = useId()
  const linkInput = useRef<HTMLInputElement>(null)
  const [copyStatus, setCopyStatus] = useState<'copied' | 'copyFailed'>()
  const queryKey = ['user', user?.id, 'referral']
  const referral = useQuery({
    queryKey,
    queryFn: ({ signal }) => credits.referral(signal),
    enabled: !!user,
  })
  const generate = useOwnedMutation(user?.id, async (check) => {
    const result = await credits.generateReferral()
    await queryClient.cancelQueries({ queryKey })
    check()
    queryClient.setQueryData(queryKey, result)
  })
  const details = referral.data

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopyStatus('copied')
    } catch {
      linkInput.current?.focus()
      linkInput.current?.select()
      setCopyStatus('copyFailed')
    }
  }

  return (
    <Card as="section" aria-labelledby={id} className="mb-7 gap-4 border-border">
      <CardHeader>
        <CardTitle as="h2" id={id}>
          {t('credits.referral.title')}
        </CardTitle>
        <CardDescription>{t('credits.referral.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ApiNotice error={referral.error ?? generate.error} />
        {details ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('credits.referral.rewardDetails', {
                inviter: details.referral_inviter_bonus_credits,
                invitee: details.referral_invitee_bonus_credits,
              })}
            </p>
            {details.invite_code ? (
              <>
                <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]">
                  <Field id={id + '-code'} label={t('credits.referral.code')}>
                    <Input id={id + '-code'} value={details.invite_code} readOnly />
                  </Field>
                  <Field id={id + '-link'} label={t('credits.referral.link')}>
                    <Input id={id + '-link'} ref={linkInput} value={details.invite_url} readOnly />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void copyLink(details.invite_url)}
                  >
                    <Copy aria-hidden="true" data-icon="inline-start" />
                    {t('credits.referral.copy')}
                  </Button>
                </div>
                {copyStatus ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t(`credits.referral.${copyStatus}`)}
                  </p>
                ) : null}
              </>
            ) : (
              <Button
                type="button"
                className="justify-self-start"
                disabled={generate.isPending}
                onClick={generate.mutate}
              >
                {t(
                  generate.isPending ? 'credits.referral.generating' : 'credits.referral.generate',
                )}
              </Button>
            )}
          </>
        ) : referral.isError ? (
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={() => void referral.refetch()}
          >
            {t('common.retry')}
          </Button>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
