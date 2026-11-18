import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hasActiveAnnouncement } from '../../../api/announcement-activity'
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
  const activeQuery = useQuery({
    queryKey: ['user', userId, 'announcements', 'active'],
    queryFn: ({ signal }) => hasActiveAnnouncement(signal),
    enabled: view === 'checking',
    refetchInterval: 30_000,
  })
  const hasItems = activeQuery.data === true
  const loaded = activeQuery.isSuccess

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
