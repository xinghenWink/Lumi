import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { operations, type OperationsSettings } from '../../../api/operations'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { AdminPage } from '../../components/admin/AdminPage'
import { CheckField, NumberField } from '../../components/admin/AdminFields'
import { Panel } from '../../components/shared/Panel'
import { PageStatus } from '../../components/shared/PageStatus'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { Button } from '../../components/ui/button'
import { Field, textareaClass } from '../../components/ui/field'
import { Input } from '../../components/ui/input'

function ConfigurationForm({ initial }: { initial: OperationsSettings }) {
  const { user } = useSession(),
    runtime = useRuntime(),
    { t } = useTranslation(),
    id = useId(),
    secret = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState(() => structuredClone(initial)),
    [words, setWords] = useState(initial.sensitive_words.join('\n')),
    [clearSecret, setClearSecret] = useState(false),
    [notice, setNotice] = useState(false)
  const save = useOwnedMutation(user?.id, async (check) => {
    if (clearSecret && form.turnstile_enabled) throw new ApiError('INVALID_INPUT')
    const result = await operations.saveSettings(
      {
        ...form,
        sensitive_words: words
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      },
      clearSecret ? '' : secret.current?.value.trim() || undefined,
    )
    check()
    if (secret.current) secret.current.value = ''
    setForm(result)
    setWords(result.sensitive_words.join('\n'))
    setClearSecret(false)
    setNotice(true)
    runtime.queryClient.setQueryData(['user', user?.id, 'admin-operations-settings'], result)
    void runtime.queryClient.invalidateQueries({ queryKey: ['public', 'config'] })
  })
  return (
    <Panel>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          setNotice(false)
          save.mutate()
        }}
      >
        <fieldset disabled={save.isPending} className="grid min-w-0 gap-4">
          <CheckField
            label={t('ops.maintenance')}
            checked={form.maintenance}
            onChange={(maintenance) => setForm({ ...form, maintenance })}
          />
          <p className="text-xs leading-6 text-muted-foreground">{t('ops.maintenanceHint')}</p>
          <CheckField
            label={t('ops.turnstileEnabled')}
            checked={form.turnstile_enabled}
            onChange={(turnstile_enabled) => {
              setForm({ ...form, turnstile_enabled })
              if (turnstile_enabled) setClearSecret(false)
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id + '-site'} label={t('ops.siteKey')}>
              <Input
                id={id + '-site'}
                value={form.turnstile_site_key}
                maxLength={200}
                onChange={(event) => setForm({ ...form, turnstile_site_key: event.target.value })}
              />
            </Field>
            <Field id={id + '-hostname'} label={t('ops.hostname')}>
              <Input
                id={id + '-hostname'}
                value={form.turnstile_hostname}
                maxLength={253}
                onChange={(event) => setForm({ ...form, turnstile_hostname: event.target.value })}
              />
            </Field>
          </div>
          <Field id={id + '-secret'} label={t('ops.secret')}>
            <Input
              id={id + '-secret'}
              ref={secret}
              type="password"
              autoComplete="new-password"
              maxLength={4096}
              disabled={clearSecret}
            />
          </Field>
          {form.turnstile_secret_configured ? (
            <>
              <p className="text-xs text-muted-foreground">{t('ops.secretConfigured')}</p>
              <CheckField
                label={t('ops.clearSecret')}
                checked={clearSecret}
                onChange={setClearSecret}
                disabled={form.turnstile_enabled}
              />
            </>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('ops.registerLimit')}
              value={form.register_per_ip_day}
              max={1000}
              onChange={(register_per_ip_day) => setForm({ ...form, register_per_ip_day })}
            />
            <NumberField
              label={t('ops.circuitFailures')}
              value={form.circuit_failures}
              min={1}
              max={100}
              onChange={(circuit_failures) => setForm({ ...form, circuit_failures })}
            />
            <NumberField
              label={t('ops.circuitSeconds')}
              value={form.circuit_seconds}
              min={1}
              max={3600}
              onChange={(circuit_seconds) => setForm({ ...form, circuit_seconds })}
            />
          </div>
          <Field id={id + '-words'} label={t('ops.words')}>
            <textarea
              id={id + '-words'}
              className={textareaClass}
              rows={5}
              value={words}
              onChange={(event) => setWords(event.target.value)}
            />
          </Field>
        </fieldset>
        <ApiNotice error={save.error} />
        {notice ? (
          <p role="status" className="text-xs text-primary">
            {t('common.saved')}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
export default function OperationsSettingsPage() {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-operations-settings'],
    enabled: !!user,
    queryFn: ({ signal }) => operations.settings(signal),
    staleTime: 0,
  })
  return (
    <AdminPage title={t('nav.operations')}>
      {query.data ? (
        <ConfigurationForm initial={query.data} />
      ) : (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      )}
    </AdminPage>
  )
}
