import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { operations } from '../../../api/operations'
import { AnnouncementsContext } from '../../features/announcements/context'

const AnnouncementDialog = lazy(() => import('./AnnouncementDialog'))

export function Announcements({
  userId,
  token,
  children,
}: {
  userId: string
  token: string | null
  children: ReactNode
}) {
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
  const hasItems = (query.data?.pages[0]?.items.length ?? 0) > 0
  const loaded = query.isSuccess

  useEffect(() => {
    if (!trigger || !loaded || view !== 'checking') return
    let active = true
    function decide(show: boolean) {
      if (active)
        setView((current) => (current === 'checking' ? (show ? 'open' : 'closed') : current))
    }
    const timer = setTimeout(() => {
      if (!hasItems) decide(false)
      else
        void import('../../features/announcements/dismissal').then(
          ({ announcementSessionId, isAnnouncementDismissed }) => {
            decide(!isAnnouncementDismissed(userId, announcementSessionId(token)))
          },
          () => decide(false),
        )
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [trigger, loaded, view, hasItems, userId, token])

  return (
    <AnnouncementsContext.Provider value={controls}>
      {children}
      {view === 'open' ? (
        <Suspense fallback={null}>
          <AnnouncementDialog
            query={query}
            trigger={trigger}
            userId={userId}
            token={token}
            close={() => setView('closed')}
          />
        </Suspense>
      ) : null}
    </AnnouncementsContext.Provider>
  )
}
