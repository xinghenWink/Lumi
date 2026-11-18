import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { operations, type AnnouncementRelease } from '../../../api/operations'
import { CursorControls } from '../shared/CursorControls'
import { PageStatus } from '../shared/PageStatus'
import { Button } from '../ui/button'

export function AnnouncementReleasePicker({
  userId,
  onSelect,
}: {
  userId: string | undefined
  onSelect(release: AnnouncementRelease): void
}) {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['user', userId, 'announcement-github-releases', page],
    queryFn: ({ signal }) => operations.announcementReleases(page, true, signal),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' })
  const nextPage = query.data?.next_page || 0
  function refetch() {
    void query.refetch()
  }

  return (
    <div className="min-w-0">
      {query.isError || query.isPending ? <PageStatus error={query.error} retry={refetch} /> : null}
      {query.data?.stale ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3 text-sm">
          <p role="status" className="text-muted-foreground">
            {t('react.announcementReleaseStale')}
          </p>
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={refetch}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <>
          <ul className="grid gap-2">
            {query.data.items.map((release) => (
              <li key={release.version} className="min-w-0">
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-between gap-3 py-2 text-left whitespace-normal"
                  onClick={() => onSelect(release)}
                >
                  <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                    <span>{release.version}</span>
                    {release.name && release.name !== release.version ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {release.name}
                      </span>
                    ) : null}
                  </span>
                  <time
                    dateTime={release.published_at}
                    className="shrink-0 text-xs font-normal text-muted-foreground"
                  >
                    {date.format(new Date(release.published_at))}
                  </time>
                </Button>
              </li>
            ))}
          </ul>
          {!query.data.items.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('react.announcementReleaseEmpty')}
            </p>
          ) : null}
        </>
      ) : null}
      {page > 1 || nextPage ? (
        <div className="mt-4">
          <CursorControls
            page={page}
            nextCursor={nextPage ? String(nextPage) : ''}
            loading={query.isFetching}
            onPrevious={() => setPage(page - 1)}
            onNext={() => setPage(nextPage)}
          />
        </div>
      ) : null}
    </div>
  )
}
