import { lazy, Suspense, useId } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { announcements, type Announcement, type AnnouncementType } from '../../../api/announcements'
import { useRouteCopy } from '../../i18n/route-copy'
import {
  announcementSessionId,
  dismissAnnouncement,
  type Dismissal,
} from '../../features/announcements/dismissal'
import {
  announcementSections,
  announcementTypeKey,
} from '../../features/announcements/presentation'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { PageStatus } from './PageStatus'

const MarkdownContent = lazy(() =>
  import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
)

function AnnouncementBody({ content }: { content: string }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
      <MarkdownContent content={content} />
    </Suspense>
  )
}

function AnnouncementHistory({ type, items }: { type: AnnouncementType; items: Announcement[] }) {
  const { t, i18n } = useTranslation()
  const heading = useId()
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' })
  return (
    <section aria-labelledby={heading} className="py-4 first:pt-0 last:pb-0">
      <h3 id={heading} className="mb-4 text-sm font-semibold">
        {t('announcement.history', { type: t(announcementTypeKey[type]) })}
      </h3>
      <ol role="list" className="ms-1 border-s border-border">
        {items.map((item) => (
          <li key={item.id} className="relative min-w-0 pb-5 ps-4 last:pb-0">
            <span
              aria-hidden="true"
              className="absolute -start-1 top-1.5 size-2 rounded-full bg-primary"
            />
            <time dateTime={item.created_at} className="mb-1 block text-xs text-muted-foreground">
              {Number.isFinite(Date.parse(item.created_at))
                ? date.format(new Date(item.created_at))
                : item.created_at}
            </time>
            <AnnouncementBody content={item.content} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function StandaloneAnnouncement({ item }: { item: Announcement }) {
  const { t } = useTranslation()
  return (
    <article className="py-4 first:pt-0 last:pb-0">
      <h3 className="mb-2 text-sm font-semibold">
        {t(announcementTypeKey[item.announcement_type])}
      </h3>
      <AnnouncementBody content={item.content} />
    </article>
  )
}

export default function AnnouncementDialog({
  trigger,
  userId,
  token,
  close,
}: {
  trigger: HTMLButtonElement | null
  userId: string
  token: string | null
  close(): void
}) {
  const { t } = useTranslation()
  const copy = useRouteCopy('announcements')
  const query = useInfiniteQuery({
    queryKey: ['user', userId, 'announcements', 'feed'],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => announcements.list('feed', pageParam, signal, 20),
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    refetchInterval: 30_000,
  })
  const sections = announcementSections(query.data?.pages.flatMap((page) => page.items) ?? [])
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
      title={t(copy.ready ? 'announcement.title' : 'react.announcementButton')}
      description={t(copy.ready ? 'announcement.description' : 'common.loading')}
      className="flex flex-col overflow-hidden"
      returnFocus={{ current: trigger }}
    >
      {copy.ready ? (
        <>
          <div
            role="region"
            aria-label={t('announcement.description')}
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain px-0.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            {query.isError || query.isPending ? (
              <PageStatus
                error={query.error}
                retry={() => {
                  if (query.isFetchNextPageError) void query.fetchNextPage()
                  else void query.refetch()
                }}
              />
            ) : null}
            {sections.length ? (
              <div className="divide-y divide-border [overflow-wrap:anywhere]">
                {sections.map((section) =>
                  section.mode === 'history' ? (
                    <AnnouncementHistory
                      key={section.type}
                      type={section.type}
                      items={section.items}
                    />
                  ) : (
                    <StandaloneAnnouncement key={section.item.id} item={section.item} />
                  ),
                )}
              </div>
            ) : query.isSuccess ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('announcement.empty')}
              </p>
            ) : null}
            {query.hasNextPage && !query.isFetchNextPageError ? (
              <Button
                variant="outline"
                className="mt-4 w-full"
                disabled={query.isFetching}
                onClick={() => void query.fetchNextPage()}
              >
                {t(query.isFetchingNextPage ? 'common.loading' : 'announcement.more')}
              </Button>
            ) : null}
          </div>
          <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => dismiss('today')}>
              {t('announcement.closeToday')}
            </Button>
            <Button onClick={() => dismiss('current')}>{t('announcement.closeCurrent')}</Button>
          </div>
        </>
      ) : (
        <PageStatus error={copy.error} retry={copy.retry} />
      )}
    </ModalDialog>
  )
}
