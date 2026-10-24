import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { images, terminal } from '../../../api/images'
import { operations } from '../../../api/operations'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'
import { useTime } from '../../features/accounts/time'
import { useOwnedMutation } from '../../features/accounts/owned-mutation'
import { AdminPage } from '../../components/admin/AdminPage'
import { ImageFilters } from '../../components/images/ImageFilters'
import { ImageTaskCard } from '../../components/images/ImageTaskCard'
import { DataTable } from '../../components/shared/DataTable'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { PageStatus } from '../../components/shared/PageStatus'
import { Button } from '../../components/ui/button'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { ModalDialog } from '../../components/ui/modal-dialog'

function TaskDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose(): void
  onChanged(): void
}) {
  const { user } = useSession(),
    runtime = useRuntime(),
    { t } = useTranslation()
  const [refundOpen, setRefundOpen] = useState(false),
    [note, setNote] = useState('')
  const query = useQuery({
    queryKey: ['user', user?.id, 'admin-image-task', id],
    enabled: !!user,
    queryFn: ({ signal }) => images.task(id, true, signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const refund = useOwnedMutation(user?.id, async (check) => {
    await operations.refund(id, note.trim())
    check()
    setRefundOpen(false)
    setNote('')
    await query.refetch()
    check()
    onChanged()
    for (const kind of ['credits', 'credit-ledger', 'admin-users'])
      void runtime.queryClient.invalidateQueries({ queryKey: ['user', user?.id, kind] })
  })
  return (
    <>
      <ModalDialog
        open
        wide
        onOpenChange={(value) => {
          if (!value) onClose()
        }}
        title={t('images.details')}
        description={t('images.adminHint')}
        busy={refund.isPending}
      >
        {query.data ? (
          <>
            <ImageTaskCard
              task={query.data}
              admin
              onChanged={() => {
                void query.refetch()
                onChanged()
              }}
            />
            {terminal(query.data.status) && query.data.actual_cost > 0 ? (
              <Button
                variant="destructive"
                onClick={() => {
                  refund.reset()
                  setNote('')
                  setRefundOpen(true)
                }}
              >
                {t('ops.refund')}
              </Button>
            ) : null}
          </>
        ) : (
          <PageStatus
            {...(query.error ? { error: query.error } : {})}
            retry={() => {
              void query.refetch()
            }}
          />
        )}
        {query.data ? <ApiNotice error={query.error} /> : null}
      </ModalDialog>
      <ModalDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        title={t('ops.refund')}
        description={t('ops.refundHint')}
        busy={refund.isPending}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            refund.mutate()
          }}
        >
          <Field id={'refund-' + id} label={t('ops.note')}>
            <Input
              id={'refund-' + id}
              value={note}
              maxLength={200}
              required
              disabled={refund.isPending}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <ApiNotice error={refund.error} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={refund.isPending}
              onClick={() => setRefundOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={refund.isPending || !note.trim()}>
              {t('ops.confirm')}
            </Button>
          </div>
        </form>
      </ModalDialog>
    </>
  )
}
export default function ImageTasksPage() {
  const { user } = useSession(),
    { t, i18n } = useTranslation(),
    time = useTime()
  const [filter, setFilter] = useState('limit=40'),
    [selected, setSelected] = useState('')
  const query = useInfiniteQuery({
    queryKey: ['user', user?.id, 'admin-image-tasks', filter],
    enabled: !!user,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(filter)
      if (pageParam) params.set('cursor', pageParam)
      return images.tasks(params, true, signal)
    },
    getNextPageParam: (page) => page.next_cursor || undefined,
    staleTime: 0,
  })
  const rows = query.data?.pages.flatMap((page) => page.items) ?? []
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value)
  return (
    <AdminPage
      title={t('images.adminTitle')}
      description={t('images.adminHint')}
      actions={
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('images.refresh')}
        </Button>
      }
    >
      <div className="mb-5">
        <ImageFilters admin onApply={(params) => setFilter(params.toString())} />
      </div>
      <ApiNotice error={query.error} />
      {query.isPending ? (
        <PageStatus />
      ) : query.isError && !rows.length ? (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.retry')}
        </Button>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <DataTable
            rows={rows}
            columns={[
              {
                key: 'task',
                label: t('images.task'),
                render: (row) => (
                  <code className="block min-w-32 break-all text-[10px]">{row.id}</code>
                ),
              },
              {
                key: 'user',
                label: t('images.user'),
                render: (row) => (
                  <code className="block min-w-32 break-all text-[10px]">{row.user_id}</code>
                ),
              },
              { key: 'model', label: t('images.model'), render: (row) => row.model_name },
              {
                key: 'state',
                label: t('images.status'),
                className: 'whitespace-nowrap',
                render: (row) => t(`images.${row.status}`),
              },
              {
                key: 'count',
                label: t('images.count'),
                className: 'whitespace-nowrap',
                render: (row) => number(row.successful_images) + ' / ' + number(row.n),
              },
              {
                key: 'quality',
                label: t('images.quality'),
                render: (row) => t(`images.${row.quality}`),
              },
              {
                key: 'cost',
                label: t('images.cost'),
                className: 'whitespace-nowrap',
                render: (row) => number(row.actual_cost) + ' / ' + number(row.refunded_cost),
              },
              {
                key: 'elapsed',
                label: t('images.elapsed'),
                render: (row) =>
                  row.started_at && row.finished_at
                    ? new Intl.NumberFormat(i18n.resolvedLanguage, {
                        maximumFractionDigits: 1,
                      }).format(
                        Math.max(0, Date.parse(row.finished_at) - Date.parse(row.started_at)) /
                          1000,
                      )
                    : t('common.none'),
              },
              {
                key: 'error',
                label: t('images.error'),
                render: (row) =>
                  row.error_code
                    ? t(
                        i18n.exists('errors.' + row.error_code)
                          ? 'errors.' + row.error_code
                          : 'errors.UNKNOWN_ERROR',
                      )
                    : t('common.none'),
              },
              {
                key: 'created',
                label: t('images.created'),
                className: 'whitespace-nowrap',
                render: (row) => time(row.created_at),
              },
              {
                key: 'details',
                label: t('images.details'),
                render: (row) => (
                  <Button variant="ghost" size="sm" onClick={() => setSelected(row.id)}>
                    {t('images.details')}
                  </Button>
                ),
              },
            ]}
          />
          {!rows.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : null}
        </div>
      )}
      {query.hasNextPage ? (
        <Button
          variant="outline"
          className="mt-5"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage()
          }}
        >
          {t('images.more')}
        </Button>
      ) : null}
      {selected ? (
        <TaskDetail
          key={selected}
          id={selected}
          onClose={() => setSelected('')}
          onChanged={() => {
            void query.refetch()
          }}
        />
      ) : null}
    </AdminPage>
  )
}
