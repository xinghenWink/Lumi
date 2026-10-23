import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, MessageSquare, Sparkles } from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePublicConfig } from '../features/auth/hooks'
import { createChallenge } from '../features/auth/turnstile'
import { useRuntime } from '../app/context'
import { ApiNotice } from '../components/shared/ApiNotice'
import { PageStatus } from '../components/shared/PageStatus'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ApiError } from '../../api/transport'
import { safeRedirect, validEmail, validPassword } from '../../features/accounts/utils'

function AuthForm({ registering }: { registering: boolean }) {
  const { t, i18n } = useTranslation()
  const runtime = useRuntime()
  const config = usePublicConfig()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState('')
  const [notice, setNotice] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const challenge = useRef<ReturnType<typeof createChallenge> | null>(null)
  const key = config.data?.turnstile_site_key ?? ''
  useEffect(() => {
    const widget = createChallenge(
      () => container.current,
      () => key,
    )
    challenge.current = widget
    return () => {
      widget.dispose()
      challenge.current = null
    }
  }, [key])
  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [seconds])
  async function token(action: 'register' | 'send_code') {
    if (!config.data?.turnstile_enabled) return undefined
    if (!challenge.current) throw new ApiError('CHALLENGE_UNAVAILABLE')
    return challenge.current.token(action)
  }
  async function sendCode() {
    setError(null)
    setValidation('')
    setNotice('')
    if (!validEmail(email.trim())) {
      setValidation(t('auth.emailInvalid'))
      return
    }
    setSending(true)
    try {
      const challengeToken = await token('send_code')
      setSeconds(
        await runtime.session.sendCode(
          email.trim(),
          i18n.resolvedLanguage === 'en' ? 'en' : 'zh-CN',
          challengeToken,
        ),
      )
      setNotice(t('auth.codeSent'))
    } catch (failure) {
      if (failure instanceof ApiError && failure.retryAfter) setSeconds(failure.retryAfter)
      setError(failure)
    } finally {
      setSending(false)
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || sending) return
    setError(null)
    setValidation('')
    setNotice('')
    if (!validEmail(email.trim())) {
      setValidation(t('auth.emailInvalid'))
      return
    }
    if (!password || (registering && !validPassword(password))) {
      setValidation(t(registering ? 'auth.passwordInvalid' : 'common.required'))
      return
    }
    if (registering && (!nickname.trim() || Array.from(nickname.trim()).length > 30)) {
      setValidation(t('auth.nicknameInvalid'))
      return
    }
    if (registering && config.data?.email_verification_enabled && !/^\d{6}$/.test(code)) {
      setValidation(t('auth.codeInvalid'))
      return
    }
    if (registering && !agreed) {
      setValidation(t('auth.termsRequired'))
      return
    }
    setBusy(true)
    try {
      if (registering)
        await runtime.session.register({
          email: email.trim(),
          password,
          nickname: nickname.trim(),
          code,
          accept_terms: true,
          turnstile_token: (await token('register')) ?? '',
        })
      else await runtime.session.login({ email: email.trim(), password })
      setPassword('')
      await navigate(safeRedirect(params.get('redirect')), { replace: true })
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  const field = 'flex flex-col gap-2 text-sm font-medium'
  const redirect = params.get('redirect')
  const suffix = redirect ? '?redirect=' + encodeURIComponent(redirect) : ''
  return (
    <>
      <nav className="mb-7 flex gap-1 rounded-xl bg-muted p-1" aria-label={t('auth.setupNote')}>
        {(
          [
            ['/login', 'auth.login'],
            ['/register', 'auth.register'],
          ] as const
        ).map(([path, label]) => (
          <NavLink
            key={path}
            to={path + suffix}
            className={({ isActive }) =>
              `flex-1 rounded-lg px-3 py-2 text-center text-sm ${isActive ? 'bg-card font-medium text-primary shadow-sm' : 'text-muted-foreground'}`
            }
          >
            {t(label)}
          </NavLink>
        ))}
      </nav>
      {config.isPending ? (
        <PageStatus />
      ) : config.isError ? (
        <PageStatus
          error={config.error}
          retry={() => {
            void config.refetch()
          }}
        />
      ) : registering && !config.data.registration_enabled ? (
        <p role="status" className="rounded-xl bg-muted p-4 text-sm leading-7">
          {t('auth.registrationClosed')}
        </p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            void submit(event)
          }}
        >
          {registering && config.data.turnstile_enabled ? (
            <div ref={container} className="max-w-full overflow-x-auto" />
          ) : null}
          {registering ? (
            <label className={field}>
              {t('auth.nickname')}
              <Input
                name="nickname"
                autoComplete="nickname"
                maxLength={30}
                placeholder={t('auth.nicknamePlaceholder')}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                disabled={busy}
              />
            </label>
          ) : null}
          <label className={field}>
            {t('auth.email')}
            <Input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className={field}>
            <label htmlFor="auth-password">{t('auth.password')}</label>
            <div className="relative">
              <Input
                id="auth-password"
                name="password"
                className="pr-12"
                type={visible ? 'text' : 'password'}
                autoComplete={registering ? 'new-password' : 'current-password'}
                maxLength={128}
                placeholder={t('auth.passwordHint')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-0.5 right-1 size-10"
                aria-label={t(visible ? 'auth.hidePassword' : 'auth.showPassword')}
                onClick={() => setVisible((value) => !value)}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </Button>
            </div>
          </div>
          {registering && config.data.email_verification_enabled ? (
            <label className={field}>
              {t('auth.code')}
              <span className="flex min-w-0 gap-2">
                <Input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder={t('auth.codePlaceholder')}
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || sending || seconds > 0}
                  onClick={() => {
                    void sendCode()
                  }}
                >
                  {sending
                    ? t('auth.sendingCode')
                    : seconds
                      ? t('auth.resend', { seconds })
                      : t('auth.sendCode')}
                </Button>
              </span>
            </label>
          ) : null}
          {registering ? (
            <label className="flex items-start gap-2.5 text-xs leading-6 text-muted-foreground">
              <input
                className="mt-1 size-4 shrink-0 accent-primary"
                type="checkbox"
                name="accept_terms"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                disabled={busy}
              />
              <span>
                {t('auth.agree')}{' '}
                <a
                  className="text-primary"
                  href={config.data.site.terms_url || '/terms'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('auth.terms')}
                </a>{' '}
                {t('auth.and')}{' '}
                <a
                  className="text-primary"
                  href={config.data.site.privacy_url || '/privacy'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('auth.privacy')}
                </a>
              </span>
            </label>
          ) : (
            <Link to="/forgot-password" className="self-end text-xs text-primary hover:underline">
              {t('ops.forgot')}
            </Link>
          )}
          {validation ? (
            <p role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          ) : null}
          <ApiNotice error={error} />
          {notice ? (
            <p role="status" className="text-sm text-primary">
              {notice}
            </p>
          ) : null}
          <Button type="submit" className="h-11 w-full" disabled={busy || sending}>
            {t(busy ? 'auth.submitting' : registering ? 'auth.create' : 'auth.enter')}
          </Button>
        </form>
      )}
    </>
  )
}

export default function AuthPage() {
  const location = useLocation()
  const registering = location.pathname === '/register'
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-16 px-4 py-8 sm:px-8 sm:py-14 lg:grid-cols-2">
      <aside className="hidden flex-col gap-7 pr-8 lg:flex">
        <span className="grid size-16 place-items-center rounded-2xl bg-accent text-primary">
          <Sparkles size={34} strokeWidth={1.4} />
        </span>
        <h2 className="text-4xl font-semibold leading-snug tracking-tight">
          {t('auth.heroTitle')}
        </h2>
        <p className="text-sm leading-8 text-muted-foreground">{t('auth.heroDescription')}</p>
        {(
          [
            [MessageSquare, 'auth.heroChat', 'auth.heroChatDescription'],
            [Sparkles, 'auth.heroImage', 'auth.heroImageDescription'],
          ] as const
        ).map(([Icon, title, description]) => (
          <div key={title} className="flex items-start gap-3">
            <span className="mt-1 text-primary">
              <Icon size={20} />
            </span>
            <div>
              <strong className="text-sm">{t(title)}</strong>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">{t(description)}</p>
            </div>
          </div>
        ))}
      </aside>
      <section className="mx-auto w-full max-w-[400px] rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(registering ? 'auth.registerTitle' : 'auth.loginTitle')}
        </h1>
        <p className="mt-2 mb-7 text-sm leading-6 text-muted-foreground">
          {t(registering ? 'auth.registerDescription' : 'auth.loginDescription')}
        </p>
        <AuthForm key={location.pathname} registering={registering} />
      </section>
    </div>
  )
}
