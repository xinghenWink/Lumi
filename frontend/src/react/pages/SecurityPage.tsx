import { useId, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { operations, type Preferences } from '../../api/operations'
import type { User } from '../../api/contracts'
import { useRuntime } from '../app/context'
import { useSession } from '../features/auth/hooks'
import { useOwnedMutation } from '../features/accounts/owned-mutation'
import { usePrivateDownload } from '../features/files/download'
import { useTime } from '../features/accounts/time'
import { Panel } from '../components/shared/Panel'
import { ApiNotice } from '../components/shared/ApiNotice'
import { ModalDialog } from '../components/ui/modal-dialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Field, selectClass, textareaClass } from '../components/ui/field'

function SecurityForm({ user }: { user: User }) {
  // Preference enums/bounds follow OpenAPI; the composer derives model capabilities separately.
  const runtime = useRuntime(),
    { t } = useTranslation(),
    navigate = useNavigate(),
    time = useTime(),
    id = useId(),
    download = usePrivateDownload()
  const [draft, setDraft] = useState<Partial<Preferences>>({}),
    [saved, setSaved] = useState(false)
  const [revokeID, setRevokeID] = useState(''),
    [deleting, setDeleting] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('')
  const revokeTrigger = useRef<HTMLButtonElement>(null),
    deleteTrigger = useRef<HTMLButtonElement>(null)
  const preferences = useQuery({
    queryKey: ['user', user.id, 'preferences'],
    queryFn: ({ signal }) => operations.preferences(signal),
  })
  const devices = useInfiniteQuery({
    queryKey: ['user', user.id, 'devices'],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => operations.devices(pageParam, signal),
    getNextPageParam: (page) => page.next_cursor || undefined,
  })
  const values = preferences.data ? { ...preferences.data, ...draft } : undefined
  const rows = devices.data?.pages.flatMap((page) => page.items) ?? []
  const currentID = devices.data?.pages[0]?.current_id
  const save = useOwnedMutation(
    user.id,
    async (check) => {
      if (!values) return
      const result = await operations.savePreferences(values)
      check()
      runtime.queryClient.setQueryData(['user', user.id, 'preferences'], result)
      runtime.themeStore.getState().setTheme(result.theme)
      setDraft({})
      setSaved(true)
    },
    { scope: 'appearance' },
  )
  const revoke = useOwnedMutation(
    user.id,
    async (check) => {
      const target = revokeID
      await operations.revoke(target)
      check()
      if (target === currentID) {
        runtime.clearSession()
        await navigate('/login', { replace: true })
      } else {
        setRevokeID('')
        await runtime.queryClient.invalidateQueries({ queryKey: ['user', user.id, 'devices'] })
      }
    },
    { endsSession: true },
  )
  const remove = useOwnedMutation(
    user.id,
    async (check) => {
      await operations.deleteSelf(email, password)
      check()
      setPassword('')
      runtime.clearSession()
      await navigate('/login', { replace: true })
    },
    { endsSession: true },
  )
  const json = useOwnedMutation(user.id, () =>
    download('/api/v1/me/chat-export?format=json', 'lumi-chats.json'),
  )
  const markdown = useOwnedMutation(user.id, () =>
    download('/api/v1/me/chat-export?format=markdown', 'lumi-chats.md'),
  )
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('nav.security')}</h1>
        <Panel title={t('ops.preferences')}>
          <ApiNotice error={preferences.error || save.error} />
          {values ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                setSaved(false)
                save.mutate()
              }}
            >
              <Field id={id + '-theme'} label={t('ops.theme')}>
                <select
                  id={id + '-theme'}
                  className={selectClass}
                  value={values.theme}
                  disabled={save.isPending}
                  onChange={(event) => {
                    const theme = event.target.value
                    if (theme === 'light' || theme === 'dark' || theme === 'system')
                      setDraft({ ...draft, theme })
                  }}
                >
                  {['light', 'dark', 'system'].map((theme) => (
                    <option key={theme} value={theme}>
                      {t('ops.' + theme)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id={id + '-instructions'}
                label={t('ops.instructions')}
                hint={t('ops.instructionsHint')}
              >
                <textarea
                  id={id + '-instructions'}
                  rows={5}
                  maxLength={4000}
                  className={textareaClass}
                  value={values.instructions}
                  disabled={save.isPending}
                  onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id={id + '-quality'} label={t('ops.imageQuality')}>
                  <select
                    id={id + '-quality'}
                    className={selectClass}
                    value={values.image_quality}
                    disabled={save.isPending}
                    onChange={(event) => {
                      const quality = event.target.value
                      if (quality === 'low' || quality === 'medium' || quality === 'high')
                        setDraft({ ...draft, image_quality: quality })
                    }}
                  >
                    {['low', 'medium', 'high'].map((quality) => (
                      <option key={quality} value={quality}>
                        {t('images.' + quality)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={id + '-ratio'} label={t('ops.imageRatio')}>
                  <select
                    id={id + '-ratio'}
                    className={selectClass}
                    value={values.image_ratio}
                    disabled={save.isPending}
                    onChange={(event) => setDraft({ ...draft, image_ratio: event.target.value })}
                  >
                    {['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'].map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={id + '-count'} label={t('ops.imageCount')}>
                  <Input
                    id={id + '-count'}
                    type="number"
                    min={1}
                    max={4}
                    required
                    value={values.image_count}
                    disabled={save.isPending}
                    onChange={(event) =>
                      setDraft({ ...draft, image_count: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>
              {saved ? (
                <p role="status" className="text-xs text-primary">
                  {t('common.saved')}
                </p>
              ) : null}
              <div>
                <Button type="submit" disabled={save.isPending}>
                  {t('common.save')}
                </Button>
              </div>
            </form>
          ) : preferences.isError ? (
            <Button
              variant="outline"
              onClick={() => {
                void preferences.refetch()
              }}
            >
              {t('common.retry')}
            </Button>
          ) : (
            <p role="status" className="text-sm">
              {t('common.loading')}
            </p>
          )}
        </Panel>
        <Panel title={t('ops.devices')}>
          <ApiNotice error={devices.error} />
          {devices.isPending ? <p role="status">{t('common.loading')}</p> : null}
          <div className="divide-y divide-border">
            {rows.map((device) => (
              <article
                key={device.id}
                data-session-id={device.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0"
              >
                <div className="min-w-0">
                  <strong className="text-sm">{device.device}</strong>
                  {device.id === currentID ? (
                    <span className="ml-2 rounded-md bg-accent px-2 py-1 text-[10px] text-primary">
                      {t('ops.currentDevice')}
                    </span>
                  ) : null}
                  <p className="mt-2 break-all text-xs leading-5 text-muted-foreground">
                    {device.ip} · {time(device.created_at)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={(event) => {
                    revokeTrigger.current = event.currentTarget
                    revoke.reset()
                    setRevokeID(device.id)
                  }}
                >
                  {t('ops.revoke')}
                </Button>
              </article>
            ))}
          </div>
          {devices.hasNextPage ? (
            <Button
              variant="outline"
              disabled={devices.isFetchingNextPage}
              onClick={() => {
                void devices.fetchNextPage()
              }}
            >
              {t('images.more')}
            </Button>
          ) : null}
          {devices.isError ? (
            <Button
              variant="outline"
              onClick={() => {
                void devices.refetch()
              }}
            >
              {t('common.retry')}
            </Button>
          ) : null}
        </Panel>
        <Panel title={t('ops.export')} description={t('ops.exportHint')}>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={json.isPending} onClick={() => json.mutate()}>
              {t('ops.exportJSON')}
            </Button>
            <Button
              variant="outline"
              disabled={markdown.isPending}
              onClick={() => markdown.mutate()}
            >
              {t('ops.exportMarkdown')}
            </Button>
          </div>
          <ApiNotice error={json.error || markdown.error} />
        </Panel>
        <Panel title={t('ops.deleteAccount')} description={t('ops.deleteAccountHint')}>
          <Button
            ref={deleteTrigger}
            variant="destructive"
            onClick={() => {
              remove.reset()
              setEmail('')
              setPassword('')
              setDeleting(true)
            }}
          >
            {t('ops.deleteAccount')}
          </Button>
        </Panel>
        <ModalDialog
          open={!!revokeID}
          onOpenChange={(value) => {
            if (!value) setRevokeID('')
          }}
          title={t('ops.revoke')}
          description={t('ops.revokeConfirm')}
          busy={revoke.isPending}
          returnFocus={revokeTrigger}
        >
          <ApiNotice error={revoke.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={revoke.isPending} onClick={() => setRevokeID('')}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              {t('ops.confirm')}
            </Button>
          </div>
        </ModalDialog>
        <ModalDialog
          open={deleting}
          onOpenChange={(value) => {
            setDeleting(value)
            if (!value) setPassword('')
          }}
          title={t('ops.deleteAccount')}
          description={t('ops.deleteAccountHint')}
          busy={remove.isPending}
          returnFocus={deleteTrigger}
        >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              remove.mutate()
            }}
          >
            <Field id={id + '-email'} label={t('ops.confirmEmail')}>
              <Input
                id={id + '-email'}
                type="email"
                autoComplete="email"
                required
                value={email}
                disabled={remove.isPending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field id={id + '-password'} label={t('ops.password')}>
              <Input
                id={id + '-password'}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                maxLength={128}
                disabled={remove.isPending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <ApiNotice error={remove.error} />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  setDeleting(false)
                  setPassword('')
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={remove.isPending || email !== user.email || !password}
              >
                {t('ops.confirm')}
              </Button>
            </div>
          </form>
        </ModalDialog>
      </div>
    </div>
  )
}
export default function SecurityPage() {
  const { user } = useSession()
  return user ? <SecurityForm key={user.id} user={user} /> : null
}
