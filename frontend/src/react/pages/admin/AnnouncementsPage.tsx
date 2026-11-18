import { lazy, Suspense, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Plus } from 'lucide-react'
import {
  announcements,
  type Announcement,
  type AnnouncementDisplayMode,
  type AnnouncementType,
} from '../../../api/announcements'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { useCursorQuery } from '../../features/accounts/resources'
import { AdminPage } from '../../components/admin/AdminPage'
import { AnnouncementReleasePicker } from '../../components/admin/AnnouncementReleasePicker'
import { CheckField } from '../../components/admin/AdminFields'
import { Panel } from '../../components/shared/Panel'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { CursorControls } from '../../components/shared/CursorControls'
import { PageStatus } from '../../components/shared/PageStatus'
import { Button } from '../../components/ui/button'
import { ChoiceGroup } from '../../components/ui/choice-group'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { ModalDialog } from '../../components/ui/modal-dialog'
import { Textarea } from '../../components/ui/textarea'
import { announcementTypeKey } from '../../features/announcements/presentation'
import {
  announcementCharacterLimit,
  announcementReleaseURL,
  releaseDraft,
} from '../../features/announcements/release'

const Markdown = lazy(() =>
  import('../../components/shared/MarkdownContent').then((module) => ({
    default: module.MarkdownContent,
  })),
)
const displayModeKey = {
  standalone: 'ops.announcementStandalone',
  history: 'ops.announcementHistoryMode',
} as const satisfies Record<AnnouncementDisplayMode, string>

function AnnouncementEditor({
  row,
  fromGitHub,
  returnFocus,
  onClose,
  onSaved,
}: {
  row: Announcement | null
  fromGitHub?: boolean
  returnFocus: RefObject<HTMLButtonElement | null>
  onClose(): void
  onSaved(): void
}) {
  const { user } = useSession(),
    { t } = useTranslation(),
    id = useId()
  const contentField = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<ReturnType<typeof releaseDraft> | null>(null)
  const picking = fromGitHub && !draft
  const source = row?.github_release_tag ?? draft?.tag
  const [type, setType] = useState<AnnouncementType>(
    row?.announcement_type ?? (fromGitHub ? 'system_update' : 'daily'),
  )
  const [selectedMode, setMode] = useState<AnnouncementDisplayMode | null>(
    row?.display_mode ?? null,
  )
  const displayMode = selectedMode ?? (type === 'system_update' ? 'history' : 'standalone')
  const [form, setForm] = useState({
    content: row?.content ?? '',
    starts: (row?.starts_at ?? new Date().toISOString()).slice(0, 16),
    ends: row?.ends_at?.slice(0, 16) ?? '',
    enabled: row?.enabled ?? true,
  })
  const overLimit = Array.from(form.content).length > announcementCharacterLimit
  useEffect(() => {
    if (draft) contentField.current?.focus({ preventScroll: true })
  }, [draft])
  const save = useOwnedMutation(user?.id, async (check) => {
    const start = new Date(form.starts + 'Z'),
      end = form.ends ? new Date(form.ends + 'Z') : null
    if (
      overLimit ||
      !Number.isFinite(start.getTime()) ||
      (end && (!Number.isFinite(end.getTime()) || end <= start))
    )
      throw new ApiError('INVALID_INPUT')
    await announcements.save(
      {
        content: form.content,
        starts_at: start.toISOString(),
        ends_at: end?.toISOString() ?? null,
        enabled: form.enabled,
        version: row?.version ?? 0,
        announcement_type: type,
        display_mode: displayMode,
        ...(draft ? { github_release_tag: draft.tag } : {}),
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
      title={t(picking ? 'ops.announcementImport' : row ? 'ops.edit' : 'ops.addAnnouncement')}
      description={t(picking ? 'ops.announcementChooseRelease' : 'ops.content')}
      busy={save.isPending}
      returnFocus={returnFocus}
    >
      {picking ? (
        <AnnouncementReleasePicker
          userId={user?.id}
          onSelect={(release) => {
            const nextDraft = releaseDraft(release)
            setDraft(nextDraft)
            setForm((current) => ({ ...current, content: nextDraft.content }))
          }}
        />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <fieldset className="grid min-w-0 gap-4" disabled={save.isPending}>
            {source ? <ReleaseSource tag={source} /> : null}
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              <ChoiceGroup<AnnouncementType>
                label={t('ops.announcementType')}
                value={type}
                options={[
                  { value: 'system_update', label: t(announcementTypeKey.system_update) },
                  { value: 'daily', label: t(announcementTypeKey.daily) },
                ]}
                onChange={setType}
                disabled={save.isPending}
              />
              <ChoiceGroup<AnnouncementDisplayMode>
                label={t('ops.announcementDisplayMode')}
                value={displayMode}
                options={[
                  { value: 'standalone', label: t(displayModeKey.standalone) },
                  { value: 'history', label: t(displayModeKey.history) },
                ]}
                onChange={setMode}
                disabled={save.isPending}
              />
            </div>
            {displayMode === 'history' ? (
              <p className="text-xs text-muted-foreground">{t('ops.announcementHistoryHint')}</p>
            ) : null}
            <Field id={id + '-content'} label={t('ops.content')}>
              <Textarea
                ref={contentField}
                id={id + '-content'}
                className="min-h-36 max-h-64 field-sizing-fixed"
                value={form.content}
                rows={7}
                required
                aria-invalid={overLimit}
                aria-describedby={overLimit || draft?.truncated ? id + '-content-limit' : undefined}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
              />
              {overLimit || draft?.truncated ? (
                <p
                  id={id + '-content-limit'}
                  role={overLimit ? 'alert' : 'status'}
                  className="text-xs text-muted-foreground"
                >
                  {t(overLimit ? 'ops.announcementTooLong' : 'ops.announcementTruncated', {
                    limit: announcementCharacterLimit,
                  })}
                </p>
              ) : null}
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
            <Button type="submit" disabled={save.isPending || overLimit}>
              {t(draft && form.enabled ? 'ops.announcementPublish' : 'common.save')}
            </Button>
          </div>
        </form>
      )}
    </ModalDialog>
  )
}

function ReleaseSource({ tag }: { tag: string }) {
  const { t } = useTranslation()
  return (
    <a
      href={announcementReleaseURL(tag)}
      target="_blank"
      rel="noopener noreferrer"
      className="w-fit text-sm text-primary underline underline-offset-4"
    >
      {t('ops.announcementReleaseSource', { version: tag })}
    </a>
  )
}

export default function AnnouncementsPage() {
  const { user } = useSession(),
    runtime = useRuntime(),
    { t } = useTranslation()
  const editorTrigger = useRef<HTMLButtonElement | null>(null)
  const [editor, setEditor] = useState<{ row: Announcement | null; fromGitHub?: boolean } | null>(
      null,
    ),
    [deleting, setDeleting] = useState<Announcement | null>(null),
    [notice, setNotice] = useState(false)
  const query = useCursorQuery(
    ['user', user?.id, 'admin-announcements'],
    (cursor, signal) => announcements.list('admin', cursor, signal),
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
    await announcements.remove(deleting.id)
    check()
    setDeleting(null)
    query.reset()
    changed()
  })
  return (
    <AdminPage
      title={t('nav.announcements')}
      actions={
        <div className="flex flex-wrap gap-2">
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
            variant="outline"
            onClick={(event) => {
              editorTrigger.current = event.currentTarget
              setNotice(false)
              setEditor({ row: null, fromGitHub: true })
            }}
          >
            <Download data-icon="inline-start" />
            {t('ops.announcementImport')}
          </Button>
          <Button
            onClick={(event) => {
              editorTrigger.current = event.currentTarget
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
              <p className="mb-3 text-xs font-medium text-muted-foreground">
                {t(announcementTypeKey[row.announcement_type])} ·{' '}
                {t(displayModeKey[row.display_mode])}
              </p>
              <Suspense
                fallback={<p className="whitespace-pre-wrap break-words text-sm">{row.content}</p>}
              >
                <Markdown content={row.content} />
              </Suspense>
              {row.github_release_tag ? <ReleaseSource tag={row.github_release_tag} /> : null}
              <p className="mt-4 break-all text-[10px] text-muted-foreground">
                {t('ops.startsAt')}: {row.starts_at} · {t('ops.endsAt')}:{' '}
                {row.ends_at ?? t('common.none')} ·{' '}
                {t(row.enabled ? 'ops.enabled' : 'catalog.disabledState')}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    editorTrigger.current = event.currentTarget
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
          {...editor}
          returnFocus={editorTrigger}
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
