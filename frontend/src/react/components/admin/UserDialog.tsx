import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { accounts } from '../../../api/accounts'
import type { User } from '../../../api/contracts'
import { validEmail, validPassword } from '../../../features/accounts/utils'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { useRuntime } from '../../app/context'
import { ModalDialog } from '../ui/modal-dialog'
import { Field, selectClass } from '../ui/field'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { ApiNotice } from '../shared/ApiNotice'

export type UserEditor = { kind: 'create' } | { kind: 'edit' | 'delete'; user: User }
export function UserDialog({
  editor,
  onClose,
  onSaved,
}: {
  editor: UserEditor
  onClose(): void
  onSaved(notice: string): void
}) {
  const { user: actor } = useSession(),
    runtime = useRuntime(),
    navigate = useNavigate(),
    { t } = useTranslation(),
    id = useId()
  const target = editor.kind === 'create' ? undefined : editor.user
  const self = target?.id === actor?.id
  const [email, setEmail] = useState(target?.email ?? ''),
    [nickname, setNickname] = useState(target?.nickname ?? ''),
    [password, setPassword] = useState(''),
    [initial, setInitial] = useState('0')
  const [role, setRole] = useState<User['role']>(target?.role ?? 'user'),
    [status, setStatus] = useState<User['status']>(target?.status ?? 'active')
  const [confirmation, setConfirmation] = useState(''),
    [validation, setValidation] = useState('')
  const save = useOwnedMutation(
    actor?.id,
    async (check) => {
      if (editor.kind === 'delete') {
        await accounts.delete(editor.user.id, confirmation.trim())
        check()
        onSaved('admin.users.deleteSuccess')
        return
      }
      const result =
        editor.kind === 'create'
          ? await accounts.create({
              email: email.trim(),
              nickname: nickname.trim(),
              password,
              role,
              initial_credits: Number(initial),
            })
          : await accounts.update(editor.user.id, {
              email: email.trim(),
              nickname: nickname.trim(),
              role,
              status,
              ...(password ? { password } : {}),
            })
      check()
      if (result.id === actor?.id) {
        if (target?.email !== result.email || password) {
          setPassword('')
          runtime.clearSession()
          await navigate('/login', { replace: true })
          return
        }
        runtime.session.updateUser(result)
      }
      setPassword('')
      onSaved(editor.kind === 'create' ? 'admin.users.createSuccess' : 'admin.users.updateSuccess')
    },
    { endsSession: true },
  )
  function submit() {
    setValidation('')
    if (editor.kind !== 'delete') {
      if (!validEmail(email.trim())) {
        setValidation('auth.emailInvalid')
        return
      }
      if (!nickname.trim() || Array.from(nickname.trim()).length > 30) {
        setValidation('auth.nicknameInvalid')
        return
      }
      if ((editor.kind === 'create' || password) && !validPassword(password)) {
        setValidation('auth.passwordInvalid')
        return
      }
    }
    save.mutate()
  }
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      busy={save.isPending}
      title={t(
        editor.kind === 'create'
          ? 'admin.users.new'
          : editor.kind === 'edit'
            ? 'admin.users.edit'
            : 'admin.users.delete',
      )}
      description={t(
        editor.kind === 'create'
          ? 'admin.users.createDescription'
          : editor.kind === 'edit'
            ? 'admin.users.editDescription'
            : 'admin.users.deleteDescription',
      )}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {editor.kind === 'delete' ? (
          <>
            <p className="break-all rounded-xl bg-muted p-3 text-sm">{target?.email}</p>
            <Field id={id + '-confirm'} label={t('admin.users.deleteConfirm')}>
              <Input
                id={id + '-confirm'}
                type="email"
                autoComplete="off"
                required
                value={confirmation}
                disabled={save.isPending}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field id={id + '-email'} label={t('auth.email')}>
              <Input
                id={id + '-email'}
                type="email"
                required
                maxLength={254}
                value={email}
                disabled={save.isPending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field id={id + '-nickname'} label={t('auth.nickname')}>
              <Input
                id={id + '-nickname'}
                required
                maxLength={30}
                value={nickname}
                disabled={save.isPending}
                onChange={(event) => setNickname(event.target.value)}
              />
            </Field>
            <Field id={id + '-password'} label={t('auth.password')}>
              <Input
                id={id + '-password'}
                type="password"
                autoComplete="new-password"
                maxLength={128}
                required={editor.kind === 'create'}
                placeholder={t(
                  editor.kind === 'edit' ? 'admin.users.passwordOptional' : 'auth.passwordHint',
                )}
                value={password}
                disabled={save.isPending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {editor.kind === 'create' ? (
                <Field
                  id={id + '-initial'}
                  label={t('credits.initial')}
                  hint={t('credits.initialHint')}
                >
                  <Input
                    id={id + '-initial'}
                    type="number"
                    min={0}
                    max={1e12}
                    step={1}
                    required
                    value={initial}
                    disabled={save.isPending}
                    onChange={(event) => setInitial(event.target.value)}
                  />
                </Field>
              ) : null}
              <Field id={id + '-role'} label={t('admin.users.role')}>
                <select
                  id={id + '-role'}
                  className={selectClass}
                  disabled={save.isPending || self}
                  value={role}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === 'user' || value === 'admin') setRole(value)
                  }}
                >
                  {['user', 'admin'].map((role) => (
                    <option key={role} value={role}>
                      {t(`admin.users.${role}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {editor.kind === 'edit' ? (
                <Field id={id + '-status'} label={t('admin.users.status')}>
                  <select
                    id={id + '-status'}
                    className={selectClass}
                    disabled={save.isPending || self}
                    value={status}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === 'active' || value === 'disabled') setStatus(value)
                    }}
                  >
                    {['active', 'disabled'].map((status) => (
                      <option key={status} value={status}>
                        {t(`admin.users.${status}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
            {self ? (
              <p className="text-xs text-muted-foreground">{t('admin.users.selfProtected')}</p>
            ) : null}
          </>
        )}
        {validation ? (
          <p role="alert" className="text-xs text-destructive">
            {t(validation)}
          </p>
        ) : null}
        <ApiNotice error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant={editor.kind === 'delete' ? 'destructive' : 'default'}
            disabled={
              save.isPending ||
              (editor.kind === 'delete' &&
                confirmation.trim().toLowerCase() !== target?.email.toLowerCase())
            }
          >
            {t(
              editor.kind === 'create'
                ? 'admin.users.createAction'
                : editor.kind === 'delete'
                  ? 'admin.users.deleteAction'
                  : 'common.save',
            )}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
