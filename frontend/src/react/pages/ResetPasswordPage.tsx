import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { operations } from '../../api/operations'
import { validEmail, validPassword } from '../../features/accounts/utils'
import { ApiNotice } from '../components/shared/ApiNotice'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Field, FieldGroup } from '../components/ui/field'
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
      <Card className="gap-5 rounded-2xl border border-border bg-card p-6 shadow-md sm:p-8">
        <CardHeader className="p-0">
          <CardTitle as="h1" className="text-[22px] font-semibold tracking-tight">
            {t(resetting ? 'ops.resetTitle' : 'ops.forgotTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 p-0">
          <ApiNotice error={error} />
          {done ? (
            <p role="status" className="text-sm leading-7">
              {t(resetting ? 'ops.resetDone' : 'ops.resetSent')}
            </p>
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                void submit(event)
              }}
            >
              <FieldGroup className="gap-5">
                <Field
                  id="reset-credential"
                  label={t(resetting ? 'ops.newPassword' : 'auth.email')}
                  invalid={!!validation}
                >
                  <Input
                    id="reset-credential"
                    aria-invalid={!!validation}
                    aria-describedby={validation ? 'reset-validation' : undefined}
                    type={resetting ? 'password' : 'email'}
                    autoComplete={resetting ? 'new-password' : 'email'}
                    value={resetting ? password : email}
                    onChange={(event) =>
                      resetting ? setPassword(event.target.value) : setEmail(event.target.value)
                    }
                    maxLength={resetting ? 128 : 254}
                    disabled={busy}
                  />
                </Field>
                {validation ? (
                  <p id="reset-validation" role="alert" className="text-sm text-destructive">
                    {validation}
                  </p>
                ) : null}
                <Button type="submit" disabled={busy}>
                  {t(busy ? 'auth.submitting' : resetting ? 'ops.resetPassword' : 'ops.sendReset')}
                </Button>
              </FieldGroup>
            </form>
          )}
          <Link className="text-sm text-primary hover:underline" to="/login">
            {t('ops.backLogin')}
          </Link>
        </CardContent>
      </Card>
    </section>
  )
}
