import { lazy, Suspense, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { operations } from '../../../api/operations'
import { useRuntime } from '../../app/context'
import { useSession } from '../../features/auth/hooks'

const MarkdownContent = lazy(() =>
  import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
)

export function RuntimeBanner() {
  const runtime = useRuntime()
  const { user, epoch } = useSession()
  const announcements = useQuery({
    queryKey: ['user', user?.id, 'announcements'],
    enabled: !!user,
    queryFn: () => operations.announcements(),
    refetchInterval: 30_000,
  })
  const preferences = useQuery({
    queryKey: ['user', user?.id, 'preferences'],
    enabled: !!user,
    queryFn: ({ signal }) => operations.preferences(signal),
    staleTime: Infinity,
  })
  useEffect(() => {
    if (preferences.data && runtime.session.snapshot().epoch === epoch)
      runtime.themeStore.getState().setTheme(preferences.data.theme)
  }, [preferences.data, runtime, epoch])
  return announcements.data?.items.length ? (
    <aside className="shrink-0 border-b border-border bg-accent px-4 py-2 sm:px-6">
      {announcements.data.items.map((item) => (
        <Suspense
          key={item.id}
          fallback={<p className="whitespace-pre-wrap text-sm">{item.content}</p>}
        >
          <MarkdownContent content={item.content} />
        </Suspense>
      ))}
    </aside>
  ) : null
}
