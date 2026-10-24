import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { accounts } from '../../api/accounts'
import { images } from '../../api/images'
import { operations } from '../../api/operations'
import { ApiError } from '../../api/transport'
import type { User } from '../../api/contracts'
import { validPassword } from '../../features/accounts/utils'
import { useRuntime } from '../app/context'
import { useSession } from '../features/auth/hooks'
import { useOwnedMutation } from '../features/accounts/owned-mutation'
import { Panel } from '../components/shared/Panel'
import { UserAvatar } from '../components/shared/UserAvatar'
import { ApiNotice } from '../components/shared/ApiNotice'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Field, selectClass } from '../components/ui/field'

function ProfileForm({ user }: { user: User }) {
  const runtime = useRuntime(),
    { t, i18n } = useTranslation(),
    navigate = useNavigate(),
    id = useId()
  const [form, setForm] = useState({
    nickname: user.nickname,
    locale: user.locale,
    timezone: user.timezone,
  })
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' }),
    [validation, setValidation] = useState(''),
    [saved, setSaved] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null)
  const avatarFile = useRef<File | null>(null)
  const theme = useStore(runtime.themeStore, (state) => state.preference)
  const desiredTheme = useRef(theme)
  useEffect(
    () => () => {
      controller.current?.abort()
      avatarFile.current = null
    },
    [],
  )
  const update = useOwnedMutation(user.id, async (check) => {
    if (!form.nickname.trim() || Array.from(form.nickname.trim()).length > 30)
      throw new ApiError('INVALID_INPUT')
    const result = await accounts.updateMe({ ...form, nickname: form.nickname.trim() })
    check()
    runtime.session.updateUser(result)
    await i18n.changeLanguage(result.locale)
    check()
    setSaved(true)
  })
  const avatar = useOwnedMutation(user.id, async (check) => {
    const file = avatarFile.current
    if (!file) return
    // The avatar size limit is the existing OpenAPI upload contract, separate from model capabilities.
    if (file.size > 2_097_152) throw new ApiError('FILE_TOO_LARGE')
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    const result = await images.upload(file, current.signal, true)
    check()
    if (current.signal.aborted) return
    const profile = runtime.session.getSnapshot().user
    if (!profile) throw new ApiError('AUTH_REQUIRED', 401)
    runtime.queryClient.setQueryData(['user', user.id, 'file', result.id], result)
    runtime.session.updateUser({ ...profile, avatar_file_id: result.id })
    avatarFile.current = null
  })
  const appearance = useOwnedMutation(
    user.id,
    async (check) => {
      const preferences = await operations.preferences()
      check()
      const result = await operations.savePreferences({
        ...preferences,
        theme: desiredTheme.current,
      })
      check()
      runtime.queryClient.setQueryData(['user', user.id, 'preferences'], result)
      runtime.themeStore.getState().setTheme(result.theme)
    },
    { scope: 'appearance' },
  )
  const changePassword = useOwnedMutation(
    user.id,
    async (check) => {
      await accounts.password({ current_password: password.current, new_password: password.next })
      check()
      setPassword({ current: '', next: '', confirm: '' })
      runtime.clearSession('/login?changed=1')
      await navigate('/login?changed=1', { replace: true })
    },
    { endsSession: true },
  )
  function change() {
    setValidation('')
    if (!validPassword(password.next)) {
      setValidation('auth.passwordInvalid')
      return
    }
    if (password.next !== password.confirm) {
      setValidation('profile.mismatch')
      return
    }
    if (!password.current) {
      setValidation('common.required')
      return
    }
    changePassword.mutate()
  }
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t('profile.title')}</h1>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">{t('profile.description')}</p>
        </header>
        <Panel title={t('profile.basics')}>
          <div className="profile-avatar mb-6 flex flex-wrap items-center gap-4">
            <UserAvatar className="size-16 text-xl" />
            <div>
              <input
                ref={avatarInput}
                type="file"
                hidden
                disabled={avatar.isPending}
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file && !avatar.isPending) {
                    avatarFile.current = file
                    avatar.mutate()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={avatar.isPending}
                onClick={() => avatarInput.current?.click()}
              >
                {t('images.avatar')}
              </Button>
              <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
                {t('images.avatarHint')}
              </p>
            </div>
          </div>
          <ApiNotice error={avatar.error} />
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              setSaved(false)
              update.mutate()
            }}
          >
            <Field id={id + '-nickname'} label={t('auth.nickname')}>
              <Input
                id={id + '-nickname'}
                value={form.nickname}
                maxLength={30}
                required
                disabled={update.isPending}
                onChange={(event) => setForm({ ...form, nickname: event.target.value })}
              />
            </Field>
            <Field id={id + '-email'} label={t('auth.email')} hint={t('profile.emailReadonly')}>
              <Input id={id + '-email'} type="email" value={user.email} readOnly />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={id + '-locale'} label={t('common.locale')}>
                <select
                  id={id + '-locale'}
                  className={selectClass}
                  value={form.locale}
                  disabled={update.isPending}
                  onChange={(event) => {
                    if (event.target.value === 'zh-CN' || event.target.value === 'en')
                      setForm({ ...form, locale: event.target.value })
                  }}
                >
                  <option value="zh-CN">{t('common.zhCN')}</option>
                  <option value="en">{t('common.en')}</option>
                </select>
              </Field>
              <Field id={id + '-zone'} label={t('profile.timezone')}>
                <Input
                  id={id + '-zone'}
                  value={form.timezone}
                  maxLength={100}
                  required
                  disabled={update.isPending}
                  onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                />
              </Field>
            </div>
            <ApiNotice error={update.error} />
            {saved ? (
              <p role="status" className="text-xs text-primary">
                {t('common.saved')}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={update.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Panel>
        <Panel title={t('nav.theme')} description={t('profile.themeDescription')}>
          <div className="max-w-sm">
            <Field id={id + '-theme'} label={t('nav.theme')}>
              <select
                id={id + '-theme'}
                value={theme}
                className={selectClass}
                disabled={appearance.isPending}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'light' || value === 'dark' || value === 'system') {
                    desiredTheme.current = value
                    runtime.themeStore.getState().setTheme(value)
                    appearance.mutate()
                  }
                }}
              >
                {['light', 'dark', 'system'].map((theme) => (
                  <option key={theme} value={theme}>
                    {t('nav.' + theme)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <ApiNotice error={appearance.error} />
        </Panel>
        <Panel title={t('profile.security')} description={t('profile.securityDescription')}>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              change()
            }}
          >
            {(['current', 'next', 'confirm'] as const).map((key) => (
              <Field
                key={key}
                id={id + '-' + key}
                label={t(
                  key === 'current'
                    ? 'profile.currentPassword'
                    : key === 'next'
                      ? 'profile.newPassword'
                      : 'profile.confirmPassword',
                )}
                {...(key === 'next' ? { hint: t('auth.passwordHint') } : {})}
              >
                <Input
                  id={id + '-' + key}
                  type="password"
                  autoComplete={key === 'current' ? 'current-password' : 'new-password'}
                  maxLength={128}
                  required
                  value={password[key]}
                  disabled={changePassword.isPending}
                  onChange={(event) => setPassword({ ...password, [key]: event.target.value })}
                />
              </Field>
            ))}
            {validation ? (
              <p role="alert" className="text-xs text-destructive">
                {t(validation)}
              </p>
            ) : null}
            <ApiNotice error={changePassword.error} />
            <div>
              <Button type="submit" disabled={changePassword.isPending}>
                {t('profile.security')}
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  )
}
export default function ProfilePage() {
  const { user } = useSession()
  return user ? <ProfileForm key={user.id} user={user} /> : null
}
