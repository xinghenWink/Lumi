import { lazy, Suspense } from 'react'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { operations } from '../../../api/operations'
import {
  announcementSessionId,
  dismissAnnouncement,
  type Dismissal,
} from '../../features/announcements/dismissal'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { PageStatus } from './PageStatus'

const MarkdownContent = lazy(() =>
  import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
)

type AnnouncementPage = Awaited<ReturnType<typeof operations.announcements>>

export default function AnnouncementDialog({
  query,
  trigger,
  userId,
  token,
  close,
}: {
  query: UseInfiniteQueryResult<InfiniteData<AnnouncementPage>>
  trigger: HTMLButtonElement | null
  userId: string
  token: string | null
  close(): void
}) {
  const { t } = useTranslation()
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  function dismiss(value: Dismissal) {
    dismissAnnouncement(userId, announcementSessionId(token), value)
    close()
  }
  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss('current')
      }}
      title={t('react.announcementTitle')}
      description={t('react.announcementDescription')}
      className="flex flex-col overflow-hidden"
      returnFocus={{ current: trigger }}
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain px-0.5">
        {query.isError || query.isPending ? (
          <PageStatus
            error={query.error}
            retry={() => {
              if (query.isFetchNextPageError) void query.fetchNextPage()
              else void query.refetch()
            }}
          />
        ) : null}
        {items.length ? (
          <ul className="divide-y divide-border [overflow-wrap:anywhere]">
            {items.map((item) => (
              <li key={item.id} className="min-w-0 py-4 first:pt-0 last:pb-0">
                <Suspense fallback={<p className="whitespace-pre-wrap">{item.content}</p>}>
                  <MarkdownContent content={item.content} />
                </Suspense>
              </li>
            ))}
          </ul>
        ) : query.isSuccess ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('react.announcementEmpty')}
          </p>
        ) : null}
        {query.hasNextPage && !query.isFetchNextPageError ? (
          <Button
            variant="outline"
            className="mt-4 w-full"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {t(query.isFetchingNextPage ? 'common.loading' : 'react.announcementMore')}
          </Button>
        ) : null}
      </div>
      <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={() => dismiss('today')}>
          {t('react.announcementCloseToday')}
        </Button>
        <Button onClick={() => dismiss('current')}>{t('react.announcementCloseCurrent')}</Button>
      </div>
    </ModalDialog>
  )
}
