import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { deployment, type DeploymentJob, type DeploymentRelease } from '../../../api/deployment'
import { ApiError } from '../../../api/transport'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { Panel } from '../shared/Panel'
import { PageStatus } from '../shared/PageStatus'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'

type Confirmation = {
  action: Exclude<DeploymentRelease['action'], ''>
  source: string
  target: string
  digest: string
  key: string
}

export function DeploymentPanel({
  owner,
  version,
}: {
  owner: string | undefined
  version: string
}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [notes, setNotes] = useState<DeploymentRelease>()
  const [accepted, setAccepted] = useState<DeploymentJob>()
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null)
  const prefix = ['user', owner, 'deployment-releases'] as const
  const releasesKey = [...prefix, page] as const
  const releases = useQuery({
    queryKey: releasesKey,
    enabled: !!owner,
    queryFn: ({ signal }) => deployment.releases(page, false, signal),
    staleTime: 30_000,
  })
  const check = useOwnedMutation(owner, async (assertOwner) => {
    const result = await deployment.releases(page, true)
    assertOwner()
    client.setQueryData(releasesKey, result)
  })
  const submit = useOwnedMutation(owner, async (assertOwner) => {
    if (!confirmation) return
    const result = await deployment.enqueue(
      {
        action: confirmation.action,
        target_version: confirmation.target,
        expected_current_digest: confirmation.digest,
      },
      confirmation.key,
    )
    assertOwner()
    setAccepted(result)
    setConfirmation(undefined)
  })
  const catalogueJob = releases.data?.recent_job
  const tracked =
    accepted && (!catalogueJob || accepted.created_at >= catalogueJob.created_at)
      ? accepted
      : catalogueJob
  const trackedId = tracked?.id
  const job = useQuery({
    queryKey: ['user', owner, 'deployment-job', trackedId],
    enabled: !!owner && !!trackedId && tracked?.finished_at === null,
    queryFn: ({ signal }) => {
      if (!trackedId) throw new ApiError('INVALID_INPUT')
      return deployment.job(trackedId, signal)
    },
    refetchInterval: (query) =>
      query.state.data?.finished_at ? false : query.state.error ? 5000 : 2000,
    retry: false,
  })
  const active = job.data ?? tracked
  const completed = job.data?.finished_at
  useEffect(() => {
    if (completed) {
      void client.invalidateQueries({ queryKey: ['user', owner, 'deployment-releases'] })
      void client.invalidateQueries({ queryKey: ['user', owner, 'admin-system'] })
    }
  }, [client, completed, owner])

  const data = releases.data
  const busy = active?.finished_at === null || active?.stage === 'recovery_required'
  const currentDigest = data?.current_digest
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  const reason = (code: string) =>
    t('deployment.reasons.' + code, { defaultValue: t('deployment.unavailable') })
  const select = (release: DeploymentRelease, trigger: HTMLButtonElement) => {
    if (!release.action || !currentDigest || busy) return
    setReturnFocus(trigger)
    submit.reset()
    setConfirmation({
      action: release.action,
      source: version,
      target: release.version,
      digest: currentDigest,
      key: crypto.randomUUID(),
    })
  }
  const action = (release: DeploymentRelease) =>
    release.action ? (
      <Button
        type="button"
        size="sm"
        variant={release.action === 'rollback' ? 'outline' : 'default'}
        disabled={busy || submit.isPending}
        onClick={(event) => select(release, event.currentTarget)}
      >
        {t('deployment.' + release.action)}
      </Button>
    ) : release.reason && release.reason !== data?.executor_reason ? (
      <span className="text-xs text-muted-foreground">{reason(release.reason)}</span>
    ) : null

  return (
    <Panel className="ops-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('deployment.title')}</h2>
        <Button
          type="button"
          variant="outline"
          disabled={releases.isFetching || check.isPending}
          onClick={check.mutate}
        >
          {t('deployment.check')}
        </Button>
      </div>
      {releases.isPending || (releases.isError && !data) ? (
        <PageStatus error={releases.error} retry={() => void releases.refetch()} />
      ) : null}
      {data ? (
        <div className="mt-4 flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {t('deployment.latest', { version: data.latest?.version ?? t('common.none') })}
              </p>
              {data.checked_at ? (
                <p className="text-xs text-muted-foreground">
                  {t('deployment.checked', { time: date(data.checked_at) })}
                </p>
              ) : null}
            </div>
            {data.latest ? action(data.latest) : null}
          </div>
          {data.stale || check.isError ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('deployment.stale')}
            </p>
          ) : null}
          {data.executor_reason && !busy ? (
            <p className="text-sm text-muted-foreground">{reason(data.executor_reason)}</p>
          ) : null}
          {active ? (
            <div role="status" className="rounded-lg border border-border p-3 text-sm">
              <p>
                {t('deployment.job', { from: active.source_version, to: active.target_version })}
              </p>
              <p className="text-muted-foreground">
                {t('deployment.stage.' + active.stage)}
                {job.isError && active.finished_at === null
                  ? ' · ' + t('deployment.reconnecting')
                  : ''}
              </p>
              {active.reason ? (
                <p className="text-muted-foreground">{reason(active.reason)}</p>
              ) : null}
            </div>
          ) : null}
          {data.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('deployment.version')}</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    {t('deployment.published')}
                  </TableHead>
                  <TableHead>{t('deployment.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((release) => (
                  <TableRow key={release.version}>
                    <TableCell>
                      <p className="font-medium">{release.version}</p>
                      {release.current ? (
                        <p className="text-xs text-muted-foreground">{t('deployment.current')}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground sm:hidden">
                        {date(release.published_at)}
                      </p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {date(release.published_at)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            setReturnFocus(event.currentTarget)
                            setNotes(release)
                          }}
                        >
                          {t('deployment.notes')}
                        </Button>
                        {release.action === 'update' ? null : action(release)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t('deployment.empty')}</p>
          )}
          {page > 1 || data.next_page ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page === 1 || check.isPending}
                onClick={() => setPage(page - 1)}
              >
                {t('deployment.previous')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data.next_page || check.isPending}
                onClick={() => setPage(data.next_page)}
              >
                {t('deployment.next')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ModalDialog
        open={!!confirmation}
        onOpenChange={(open) => !open && setConfirmation(undefined)}
        title={t(confirmation?.action === 'rollback' ? 'deployment.rollback' : 'deployment.update')}
        description={t('deployment.confirm', {
          from: confirmation?.source,
          to: confirmation?.target,
        })}
        returnFocus={{ current: returnFocus }}
        busy={submit.isPending}
      >
        {submit.isError ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {reason(submit.error instanceof ApiError ? submit.error.code : '')}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={submit.isPending}
            onClick={() => setConfirmation(undefined)}
          >
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={submit.isPending} onClick={submit.mutate}>
            {t('deployment.start')}
          </Button>
        </div>
      </ModalDialog>
      <ModalDialog
        open={!!notes}
        onOpenChange={(open) => !open && setNotes(undefined)}
        title={t('deployment.notes')}
        description={notes?.version ?? ''}
        returnFocus={{ current: returnFocus }}
      >
        {notes ? (
          <div className="flex min-w-0 flex-col gap-3">
            <div
              className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap break-words text-sm"
              tabIndex={0}
            >
              {notes.notes || t('deployment.noNotes')}
            </div>
            <a
              href={notes.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline"
            >
              {t('deployment.github')}
            </a>
          </div>
        ) : null}
      </ModalDialog>
    </Panel>
  )
}
