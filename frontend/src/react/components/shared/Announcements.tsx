import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { operations } from '../../../api/operations'
import { AnnouncementsContext } from '../../features/announcements/context'
import {
  dismissAnnouncement,
  isAnnouncementDismissed,
  type Dismissal,
} from '../../features/announcements/dismissal'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { PageStatus } from './PageStatus'

const MarkdownContent = lazy(() =>
  import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
)

export function Announcements({
  userId,
  sessionId,
  children,
}: {
  userId: string
  sessionId: string | null
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<'checking' | 'open' | 'closed'>('checking')
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const controls = useMemo(() => ({ setTrigger, open: () => setView('open') }), [])
  const query = useInfiniteQuery({
    queryKey: ['user', userId, 'announcements'],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => operations.announcements(false, pageParam, signal, 20),
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    refetchInterval: 30_000,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const hasItems = items.length > 0
  const loaded = query.isSuccess

  useEffect(() => {
    if (!trigger || !loaded || view !== 'checking') return
    const timer = setTimeout(() => {
      const show = hasItems && !isAnnouncementDismissed(userId, sessionId)
      setView((current) => (current === 'checking' ? (show ? 'open' : 'closed') : current))
    }, 0)
    return () => clearTimeout(timer)
  }, [trigger, loaded, view, hasItems, userId, sessionId])

  function dismiss(dismissal: Dismissal) {
    dismissAnnouncement(userId, sessionId, dismissal)
    setView('closed')
  }

  return (
    <AnnouncementsContext.Provider value={controls}>
      {children}
      <ModalDialog
        open={view === 'open'}
        onOpenChange={(open) => {
          if (!open) dismiss('current')
        }}
        title={t('react.announcementTitle')}
        description={t('react.announcementDescription')}
        className="flex flex-col overflow-hidden"
        returnFocus={{ current: trigger }}
      >
        {view === 'open' ? (
          <>
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
              {hasItems ? (
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
              <Button onClick={() => dismiss('current')}>
                {t('react.announcementCloseCurrent')}
              </Button>
            </div>
          </>
        ) : null}
      </ModalDialog>
    </AnnouncementsContext.Provider>
  )
}
