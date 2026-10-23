import { useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { chats } from '../../../api/chat'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from './ApiNotice'
import { Button } from '../ui/button'

interface HistoryRow {
  id: string
  title: string
  pinned: boolean
}
interface HistoryPage {
  items: HistoryRow[]
  next_cursor: string
}

export function HistorySidebar({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t } = useTranslation()
  const { user } = useSession()
  const location = useLocation()
  const image = location.pathname.startsWith('/create')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const query = useInfiniteQuery({
    queryKey: ['user', user?.id, 'sidebar-history', image ? 'image' : 'chat', applied],
    initialPageParam: '',
    enabled: !!user,
    queryFn: async ({ pageParam, signal }): Promise<HistoryPage> => {
      const params = new URLSearchParams({ search: applied, limit: '50', cursor: pageParam })
      return image ? images.conversations(params, signal) : chats.list(params, signal)
    },
    getNextPageParam: (last) => last.next_cursor || undefined,
  })
  const rows = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between px-3 text-[11px] font-medium text-muted-foreground">
        <span>{t(image ? 'images.history' : 'react.recentChats')}</span>
        {!image ? (
          <Link
            to="/me/chats"
            onClick={onNavigate}
            className="rounded px-1 hover:text-primary"
            aria-label={t('nav.chatHistory')}
          >
            ···
          </Link>
        ) : null}
      </div>
      <form
        className="mx-1 mb-3 flex items-center gap-2 rounded-lg border border-transparent px-2.5 focus-within:border-border focus-within:bg-card"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied(search.trim())
        }}
      >
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          data-history-search
          type="search"
          className="h-9 min-w-0 w-full bg-transparent text-xs outline-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t(image ? 'images.search' : 'chat.search')}
          aria-label={t(image ? 'images.search' : 'chat.search')}
        />
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ApiNotice error={query.error} />
        {!query.isPending && !rows.length ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t(image ? 'images.emptyHistory' : 'chat.empty')}
          </p>
        ) : null}
        {rows.map((row) => (
          <Link
            key={row.id}
            to={(image ? '/create/' : '/chat/') + row.id}
            onClick={onNavigate}
            className={
              'mx-1 mb-0.5 flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs hover:bg-muted ' +
              (location.pathname.endsWith('/' + row.id)
                ? 'bg-accent text-primary'
                : 'text-muted-foreground')
            }
          >
            <span className="truncate">
              {row.title || t(image ? 'images.untitled' : 'chat.untitled')}
            </span>
          </Link>
        ))}
        {query.hasNextPage ? (
          <Button
            type="button"
            className="mt-2 w-full"
            variant="ghost"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage()
            }}
          >
            {t(image ? 'images.more' : 'chat.loadMore')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
