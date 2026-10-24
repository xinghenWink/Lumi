import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { accounts } from '../../../api/accounts'
import { getVersion } from '../../../api/client'
import type {
  SettingsUpdate,
  SettingsView,
  SiteSettings,
  RegistrationSettings,
} from '../../../api/contracts'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { AdminPage } from '../../components/admin/AdminPage'
import { CheckField, NumberField } from '../../components/admin/AdminFields'
import { Panel } from '../../components/shared/Panel'
import { PageStatus } from '../../components/shared/PageStatus'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { Field, selectClass, textareaClass } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'

type Group = 'site' | 'registration' | 'mail'
const siteFields = [
  ['name', 'settings.name', 40, true],
  ['description', 'settings.siteDescription', 200, false],
  ['footer', 'settings.footer', 200, false],
  ['contact', 'settings.contact', 200, false],
  ['terms_url', 'settings.termsUrl', 2048, true],
  ['privacy_url', 'settings.privacyUrl', 2048, true],
  ['logo_url', 'ops.logo', 2048, false],
  ['favicon_url', 'ops.favicon', 2048, false],
] as const
const registrationFields = [
  ['login_failure_limit', 'settings.loginFailures', 3, 20],
  ['login_lock_minutes', 'settings.lockMinutes', 1, 120],
  ['login_per_minute', 'settings.loginRate', 1, 120],
  ['register_per_minute', 'settings.registerRate', 1, 60],
  ['code_per_minute', 'settings.codeRate', 1, 20],
] as const
const domains = (value: string) =>
  value
    .split(/[,\n]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
function SettingsForm({ initial, group }: { initial: SettingsView; group: Group }) {
  const { user } = useSession(),
    runtime = useRuntime(),
    { t } = useTranslation(),
    id = useId(),
    password = useRef<HTMLInputElement>(null)
  const [site, setSite] = useState<SiteSettings>(() => ({
      ...initial.site,
      logo_url: initial.site.logo_url ?? '',
      favicon_url: initial.site.favicon_url ?? '',
    })),
    [registration, setRegistration] = useState<RegistrationSettings>(() =>
      structuredClone(initial.registration),
    ),
    [mail, setMail] = useState(() => ({ ...initial.mail })),
    [allow, setAllow] = useState(initial.registration.domain_allowlist.join('\n')),
    [block, setBlock] = useState(initial.registration.domain_blocklist.join('\n')),
    [clearPassword, setClearPassword] = useState(false),
    [notice, setNotice] = useState(false)
  const overridden = (key: string) => initial.env_overrides.includes(key)
  const label = (key: string, path: string) =>
    t(key) + (overridden(path) ? ' · ' + t('settings.envField') : '')
  const save = useOwnedMutation(user?.id, async (check) => {
    let body: SettingsUpdate
    if (group === 'site') body = { site: { ...site } }
    else if (group === 'registration')
      body = {
        registration: {
          ...registration,
          domain_allowlist: domains(allow),
          domain_blocklist: domains(block),
        },
      }
    else
      body = {
        mail: {
          host: mail.host.trim(),
          port: mail.port,
          username: mail.username,
          from: mail.from.trim(),
          encryption: mail.encryption,
          ...(clearPassword
            ? { password: '' }
            : password.current?.value
              ? { password: password.current.value }
              : {}),
        },
      }
    const result = await accounts.saveSettings(group, body)
    check()
    setSite({
      ...result.site,
      logo_url: result.site.logo_url ?? '',
      favicon_url: result.site.favicon_url ?? '',
    })
    setRegistration(result.registration)
    setMail(result.mail)
    setAllow(result.registration.domain_allowlist.join('\n'))
    setBlock(result.registration.domain_blocklist.join('\n'))
    if (password.current) password.current.value = ''
    setClearPassword(false)
    setNotice(true)
    runtime.queryClient.setQueryData(['user', user?.id, 'admin-settings', group], result)
    void runtime.queryClient.invalidateQueries({ queryKey: ['public', 'config'] })
  })
  return (
    <Panel title={t(`settings.${group}`)}>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          setNotice(false)
          save.mutate()
        }}
      >
        <fieldset className="grid min-w-0 gap-5" disabled={save.isPending}>
          {initial.env_overrides.length ? (
            <p role="note" className="rounded-xl bg-accent p-3 text-xs leading-6 text-primary">
              {t('settings.overridden')}
            </p>
          ) : null}
          {group === 'site' ? (
            <>
              {siteFields.map(([key, text, max, required]) => (
                <Field key={key} id={id + '-' + key} label={label(text, 'site.' + key)}>
                  <Input
                    id={id + '-' + key}
                    name={key}
                    value={site[key] ?? ''}
                    required={required}
                    maxLength={max}
                    disabled={overridden('site.' + key)}
                    onChange={(event) => setSite({ ...site, [key]: event.target.value })}
                  />
                </Field>
              ))}
              <p className="text-xs leading-6 text-muted-foreground">{t('settings.linksHint')}</p>
            </>
          ) : group === 'registration' ? (
            <>
              <CheckField
                role="switch"
                label={label('settings.registrationEnabled', 'registration.enabled')}
                checked={registration.enabled}
                disabled={overridden('registration.enabled')}
                onChange={(enabled) => setRegistration({ ...registration, enabled })}
              />
              <CheckField
                role="switch"
                label={label(
                  'settings.emailVerification',
                  'registration.email_verification_enabled',
                )}
                checked={registration.email_verification_enabled}
                disabled={overridden('registration.email_verification_enabled')}
                onChange={(email_verification_enabled) =>
                  setRegistration({ ...registration, email_verification_enabled })
                }
              />
              <p className="text-xs leading-6 text-muted-foreground">
                {t('settings.emailVerificationHint')}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id={id + '-allow'}
                  label={label('settings.allowlist', 'registration.domain_allowlist')}
                >
                  <textarea
                    id={id + '-allow'}
                    className={textareaClass}
                    rows={4}
                    value={allow}
                    disabled={overridden('registration.domain_allowlist')}
                    onChange={(event) => setAllow(event.target.value)}
                  />
                </Field>
                <Field
                  id={id + '-block'}
                  label={label('settings.blocklist', 'registration.domain_blocklist')}
                >
                  <textarea
                    id={id + '-block'}
                    className={textareaClass}
                    rows={4}
                    value={block}
                    disabled={overridden('registration.domain_blocklist')}
                    onChange={(event) => setBlock(event.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs leading-6 text-muted-foreground">{t('settings.domainsHint')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {registrationFields.map(([key, text, min, max]) => (
                  <NumberField
                    key={key}
                    label={label(text, 'registration.' + key)}
                    value={registration[key]}
                    min={min}
                    max={max}
                    disabled={overridden('registration.' + key)}
                    onChange={(value) => setRegistration({ ...registration, [key]: value })}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs leading-6 text-muted-foreground">{t('settings.mailHint')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={id + '-host'} label={label('settings.mailHost', 'mail.host')}>
                  <Input
                    id={id + '-host'}
                    value={mail.host}
                    maxLength={253}
                    disabled={overridden('mail.host')}
                    onChange={(event) => setMail({ ...mail, host: event.target.value })}
                  />
                </Field>
                <NumberField
                  label={label('settings.mailPort', 'mail.port')}
                  value={mail.port}
                  min={1}
                  max={65535}
                  disabled={overridden('mail.port')}
                  onChange={(port) => setMail({ ...mail, port })}
                />
              </div>
              <Field
                id={id + '-encryption'}
                label={label('settings.mailEncryption', 'mail.encryption')}
              >
                <select
                  id={id + '-encryption'}
                  className={selectClass}
                  value={mail.encryption}
                  disabled={overridden('mail.encryption')}
                  onChange={(event) => {
                    const encryption = event.target.value
                    if (encryption === 'starttls' || encryption === 'tls' || encryption === 'none')
                      setMail({ ...mail, encryption })
                  }}
                >
                  <option value="starttls">{t('settings.starttls')}</option>
                  <option value="tls">{t('settings.tls')}</option>
                  <option value="none">{t('settings.noTLS')}</option>
                </select>
              </Field>
              <Field id={id + '-from'} label={label('settings.mailFrom', 'mail.from')}>
                <Input
                  id={id + '-from'}
                  type="email"
                  value={mail.from}
                  maxLength={254}
                  disabled={overridden('mail.from')}
                  onChange={(event) => setMail({ ...mail, from: event.target.value })}
                />
              </Field>
              <Field id={id + '-username'} label={label('settings.mailUser', 'mail.username')}>
                <Input
                  id={id + '-username'}
                  value={mail.username}
                  maxLength={254}
                  autoComplete="off"
                  disabled={overridden('mail.username')}
                  onChange={(event) => setMail({ ...mail, username: event.target.value })}
                />
              </Field>
              <Field id={id + '-password'} label={label('settings.mailPassword', 'mail.password')}>
                <Input
                  id={id + '-password'}
                  ref={password}
                  type="password"
                  autoComplete="new-password"
                  maxLength={4096}
                  placeholder={t(
                    mail.password_configured
                      ? 'settings.mailSecretSaved'
                      : 'settings.mailSecretEmpty',
                  )}
                  disabled={clearPassword || overridden('mail.password')}
                />
              </Field>
              {mail.password_configured && !overridden('mail.password') ? (
                <CheckField
                  label={t('settings.mailClear')}
                  checked={clearPassword}
                  onChange={setClearPassword}
                />
              ) : null}
              <p className="text-xs leading-6 text-muted-foreground">
                {t('settings.passwordNeverReturned')}
              </p>
            </>
          )}
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
function SettingsGroup({ group }: { group: Group }) {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-settings', group],
    enabled: !!user,
    queryFn: ({ signal }) => accounts.settings(group, signal),
    staleTime: 0,
  })
  const version = useQuery({
    queryKey: ['public', 'version'],
    queryFn: ({ signal }) => getVersion(signal),
  })
  return (
    <AdminPage title={t('settings.title')} description={t('settings.description')}>
      <nav className="mb-5 flex flex-wrap gap-2" aria-label={t('settings.title')}>
        {(['site', 'registration', 'mail'] as const).map((value) => (
          <Button key={value} variant={group === value ? 'default' : 'outline'} size="sm" asChild>
            <NavLink to={'/admin/settings/' + value}>{t(`settings.${value}`)}</NavLink>
          </Button>
        ))}
      </nav>
      {query.data ? (
        <>
          <ApiNotice error={query.error} />
          <SettingsForm initial={query.data} group={group} />
        </>
      ) : (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      )}
      {version.data ? (
        <p className="mt-5 text-[10px] text-muted-foreground">
          {t('admin.version')}{' '}
          {version.data.version === 'dev' ? t('welcome.development') : version.data.version}
        </p>
      ) : null}
    </AdminPage>
  )
}
export default function SettingsPage() {
  const { group: routeGroup } = useParams()
  const group = routeGroup === 'registration' || routeGroup === 'mail' ? routeGroup : 'site'
  return <SettingsGroup key={group} group={group} />
}
