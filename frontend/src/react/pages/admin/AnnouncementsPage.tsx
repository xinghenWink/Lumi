import { lazy, Suspense, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { operations, type Announcement } from '../../../api/operations'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { useCursorQuery } from '../../features/accounts/resources'
import { AdminPage } from '../../components/admin/AdminPage'
import { CheckField } from '../../components/admin/AdminFields'
import { Panel } from '../../components/shared/Panel'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { CursorControls } from '../../components/shared/CursorControls'
import { PageStatus } from '../../components/shared/PageStatus'
import { Button } from '../../components/ui/button'
import { Field, textareaClass } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { ModalDialog } from '../../components/ui/modal-dialog'

const Markdown = lazy(() =>
  import('../../components/shared/MarkdownContent').then((module) => ({
    default: module.MarkdownContent,
  })),
)
function AnnouncementEditor({
  row,
  onClose,
  onSaved,
}: {
  row: Announcement | null
  onClose(): void
  onSaved(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation(),
    id = useId()
  const [form, setForm] = useState({
    content: row?.content ?? '',
    starts: (row?.starts_at ?? new Date().toISOString()).slice(0, 16),
    ends: row?.ends_at?.slice(0, 16) ?? '',
    enabled: row?.enabled ?? true,
  })
  const save = useOwnedMutation(user?.id, async (check) => {
    const start = new Date(form.starts + 'Z'),
      end = form.ends ? new Date(form.ends + 'Z') : null
    if (
      !Number.isFinite(start.getTime()) ||
      (end && (!Number.isFinite(end.getTime()) || end <= start))
    )
      throw new ApiError('INVALID_INPUT')
    await operations.saveAnnouncement(
      {
        content: form.content,
        starts_at: start.toISOString(),
        ends_at: end?.toISOString() ?? null,
        enabled: form.enabled,
        version: row?.version ?? 0,
      },
      row?.id,
    )
    check()
    onSaved()
  })
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t(row ? 'ops.edit' : 'ops.addAnnouncement')}
      description={t('ops.content')}
      busy={save.isPending}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <fieldset className="grid min-w-0 gap-4" disabled={save.isPending}>
          <Field id={id + '-content'} label={t('ops.content')}>
            <textarea
              id={id + '-content'}
              className={textareaClass}
              value={form.content}
              maxLength={10000}
              rows={7}
              required
              onChange={(event) => setForm({ ...form, content: event.target.value })}
            />
          </Field>
          <Field id={id + '-start'} label={t('ops.startsAt')}>
            <Input
              id={id + '-start'}
              type="datetime-local"
              required
              value={form.starts}
              onChange={(event) => setForm({ ...form, starts: event.target.value })}
            />
          </Field>
          <Field id={id + '-end'} label={t('ops.endsAt')}>
            <Input
              id={id + '-end'}
              type="datetime-local"
              value={form.ends}
              onChange={(event) => setForm({ ...form, ends: event.target.value })}
            />
          </Field>
          <CheckField
            label={t('ops.enabled')}
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
          />
        </fieldset>
        <ApiNotice error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
export default function AnnouncementsPage() {
  const { user } = useSession(),
    runtime = useRuntime(),
    { t } = useTranslation()
  const [editor, setEditor] = useState<{ row: Announcement | null } | null>(null),
    [deleting, setDeleting] = useState<Announcement | null>(null),
    [notice, setNotice] = useState(false)
  const query = useCursorQuery(
    ['user', user?.id, 'admin-announcements'],
    (cursor, signal) => operations.announcements(true, cursor, signal),
    !!user,
  )
  function changed() {
    setNotice(true)
    void runtime.queryClient.invalidateQueries({
      queryKey: ['user', user?.id, 'admin-announcements'],
    })
    void runtime.queryClient.invalidateQueries({ queryKey: ['user', user?.id, 'announcements'] })
  }
  const remove = useOwnedMutation(user?.id, async (check) => {
    if (!deleting) return
    await operations.deleteAnnouncement(deleting.id)
    check()
    setDeleting(null)
    query.reset()
    changed()
  })
  return (
    <AdminPage
      title={t('nav.announcements')}
      actions={
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch()
            }}
          >
            {t('common.refresh')}
          </Button>
          <Button
            onClick={() => {
              setNotice(false)
              setEditor({ row: null })
            }}
          >
            <Plus size={16} />
            {t('ops.addAnnouncement')}
          </Button>
        </div>
      }
    >
      {notice ? (
        <p role="status" className="mb-4 text-xs text-primary">
          {t('common.saved')}
        </p>
      ) : null}
      {query.isPending || query.isError ? (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : (
        <div className="space-y-4">
          {query.data?.items.map((row) => (
            <Panel key={row.id} className="ops-section">
              <Suspense
                fallback={<p className="whitespace-pre-wrap break-words text-sm">{row.content}</p>}
              >
                <Markdown content={row.content} />
              </Suspense>
              <p className="mt-4 break-all text-[10px] text-muted-foreground">
                {t('ops.startsAt')}: {row.starts_at} · {t('ops.endsAt')}:{' '}
                {row.ends_at ?? t('common.none')} ·{' '}
                {t(row.enabled ? 'ops.enabled' : 'catalog.disabledState')}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNotice(false)
                    setEditor({ row })
                  }}
                >
                  {t('ops.edit')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    remove.reset()
                    setDeleting(row)
                  }}
                >
                  {t('ops.remove')}
                </Button>
              </div>
            </Panel>
          ))}
          {!query.data?.items.length ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{t('common.empty')}</p>
          ) : null}
          <CursorControls
            page={query.page}
            nextCursor={query.data?.next_cursor ?? ''}
            loading={query.isFetching}
            onPrevious={query.previous}
            onNext={query.next}
          />
        </div>
      )}
      {editor ? (
        <AnnouncementEditor
          row={editor.row}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            query.reset()
            changed()
          }}
        />
      ) : null}
      <ModalDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={t('ops.confirm')}
        description={t('ops.confirmDelete')}
        busy={remove.isPending}
      >
        <ApiNotice error={remove.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('ops.confirm')}
          </Button>
        </div>
      </ModalDialog>
    </AdminPage>
  )
}
