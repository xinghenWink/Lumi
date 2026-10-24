import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { operations } from '../../api/operations'
import { validEmail, validPassword } from '../../features/accounts/utils'
import { ApiNotice } from '../components/shared/ApiNotice'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

export default function ResetPasswordPage() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const resetting = location.pathname === '/reset-password'
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState('')
  useEffect(() => {
    if (resetting) window.history.replaceState(null, '', window.location.pathname)
  }, [resetting])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setValidation('')
    if (resetting ? !validPassword(password) : !validEmail(email.trim())) {
      setValidation(t(resetting ? 'auth.passwordInvalid' : 'auth.emailInvalid'))
      return
    }
    setBusy(true)
    try {
      if (resetting) await operations.reset(token, password)
      else await operations.forgot(email.trim(), i18n.resolvedLanguage === 'en' ? 'en' : 'zh-CN')
      setPassword('')
      setDone(true)
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mx-auto my-auto w-full max-w-lg px-4 py-12">
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">
          {t(resetting ? 'ops.resetTitle' : 'ops.forgotTitle')}
        </h1>
        <ApiNotice error={error} />
        {done ? (
          <p role="status" className="text-sm leading-7">
            {t(resetting ? 'ops.resetDone' : 'ops.resetSent')}
          </p>
        ) : (
          <form
            className="flex flex-col gap-5"
            noValidate
            onSubmit={(event) => {
              void submit(event)
            }}
          >
            <label className="flex flex-col gap-2 text-sm font-medium">
              {t(resetting ? 'ops.newPassword' : 'auth.email')}
              <Input
                type={resetting ? 'password' : 'email'}
                autoComplete={resetting ? 'new-password' : 'email'}
                value={resetting ? password : email}
                onChange={(event) =>
                  resetting ? setPassword(event.target.value) : setEmail(event.target.value)
                }
                maxLength={resetting ? 128 : 254}
                disabled={busy}
              />
            </label>
            {validation ? (
              <p role="alert" className="text-sm text-destructive">
                {validation}
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {t(busy ? 'auth.submitting' : resetting ? 'ops.resetPassword' : 'ops.sendReset')}
            </Button>
          </form>
        )}
        <Link className="text-sm text-primary" to="/login">
          {t('ops.backLogin')}
        </Link>
      </div>
    </section>
  )
}
