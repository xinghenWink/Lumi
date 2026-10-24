import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { chats, type ChatConfiguration } from '../../../api/chat'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useModels } from '../../features/catalog/models'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { AdminPage } from '../../components/admin/AdminPage'
import { NumberField } from '../../components/admin/AdminFields'
import { Panel } from '../../components/shared/Panel'
import { PageStatus } from '../../components/shared/PageStatus'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { Field, selectClass, textareaClass } from '../../components/ui/field'
import { Button } from '../../components/ui/button'

function ConfigurationForm({
  initial,
  reload,
}: {
  initial: ChatConfiguration
  reload(): Promise<ChatConfiguration>
}) {
  const { user } = useSession(),
    runtime = useRuntime(),
    { t } = useTranslation(),
    id = useId(),
    models = useModels('chat')
  const [form, setForm] = useState(() => structuredClone(initial)),
    [notice, setNotice] = useState(false)
  const refresh = useOwnedMutation(user?.id, async (check) => {
    const result = await reload()
    check()
    setForm(result)
    setNotice(false)
  })
  const save = useOwnedMutation(user?.id, async (check) => {
    const result = await chats.saveSettings(form)
    check()
    setForm(result)
    setNotice(true)
    runtime.queryClient.setQueryData(['user', user?.id, 'admin-chat-settings'], result)
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
        <fieldset className="grid min-w-0 gap-5" disabled={save.isPending || refresh.isPending}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('chat.perMinute')}
              value={form.per_minute}
              max={1000}
              onChange={(per_minute) => setForm({ ...form, per_minute })}
            />
            <NumberField
              label={t('chat.perDay')}
              value={form.per_day}
              max={100000}
              onChange={(per_day) => setForm({ ...form, per_day })}
            />
          </div>
          <p className="text-xs leading-6 text-muted-foreground">{t('chat.quotaHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('chat.contextMessages')}
              value={form.context_messages}
              min={1}
              max={200}
              onChange={(context_messages) => setForm({ ...form, context_messages })}
            />
            <NumberField
              label={t('chat.contextTokens')}
              value={form.context_tokens}
              min={128}
              max={1000000}
              onChange={(context_tokens) => setForm({ ...form, context_tokens })}
            />
          </div>
          <p className="text-xs leading-6 text-muted-foreground">{t('chat.contextHint')}</p>
          <Field id={id + '-system'} label={t('chat.system')}>
            <textarea
              id={id + '-system'}
              className={textareaClass}
              rows={6}
              maxLength={32000}
              value={form.system_prompt}
              onChange={(event) => setForm({ ...form, system_prompt: event.target.value })}
            />
          </Field>
          <Field id={id + '-title'} label={t('chat.titleModel')}>
            <select
              id={id + '-title'}
              className={selectClass}
              value={form.title_model_id ?? ''}
              onChange={(event) => setForm({ ...form, title_model_id: event.target.value || null })}
            >
              <option value="">{t('chat.sameModel')}</option>
              {form.title_model_id &&
              !models.items.some((row) => row.id === form.title_model_id) ? (
                <option value={form.title_model_id}>{t('chat.unavailableModel')}</option>
              ) : null}
              {models.items.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name}
                </option>
              ))}
            </select>
          </Field>
          <ApiNotice error={models.query.error} />
        </fieldset>
        <ApiNotice error={save.error || refresh.error} />
        {notice ? (
          <p role="status" className="text-xs text-primary">
            {t('chat.saved')}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending || refresh.isPending}
            onClick={() => {
              save.reset()
              refresh.mutate()
            }}
          >
            {t('common.refresh')}
          </Button>
          <Button type="submit" disabled={save.isPending || refresh.isPending}>
            {t('chat.save')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
export default function ChatSettingsPage() {
  const { user } = useSession(),
    { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-chat-settings'],
    enabled: !!user,
    queryFn: ({ signal }) => chats.settings(signal),
    staleTime: 0,
  })
  return (
    <AdminPage title={t('chat.settings')} description={t('chat.settingsHint')}>
      {query.data ? (
        <ConfigurationForm
          initial={query.data}
          reload={async () => {
            const result = await query.refetch()
            if (result.error) throw result.error
            if (!result.data) throw new ApiError('RESPONSE_INVALID')
            return result.data
          }}
        />
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
