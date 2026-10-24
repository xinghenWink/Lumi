import { useInfiniteQuery } from '@tanstack/react-query'
import { Pin, Search } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { chats, type Conversation } from '../../../api/chat'
import { images } from '../../../api/images'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from './ApiNotice'
import { Button } from '../ui/button'
import { ConversationActions } from '../chat/ConversationActions'
const VirtualHistoryRows = lazy(() => import('./VirtualHistoryRows'))

type HistoryRow = Omit<Conversation, 'busy'> & { busy?: boolean }
interface HistoryPage {
  items: HistoryRow[]
  next_cursor: string
}

export function HistorySidebar({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t } = useTranslation()
  const { user } = useSession()
  const location = useLocation()
  const image =
    location.pathname.startsWith('/create') || location.pathname.startsWith('/me/images')
  const mode = image ? 'image' : 'chat'
  const [searches, setSearches] = useState({
    chat: { search: '', applied: '' },
    image: { search: '', applied: '' },
  })
  const { search, applied } = searches[mode]
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
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  const scroller = useRef<HTMLDivElement>(null)
  const rowKeys = useMemo(() => rows.map((row) => row.id), [rows])
  function historyRow(row: HistoryRow) {
    return (
      <div
        key={row.id}
        className={
          'chat-sidebar-row mx-1 flex h-10 items-center gap-1 rounded-lg pl-3 pr-1 text-xs hover:bg-muted ' +
          (location.pathname.endsWith('/' + row.id)
            ? 'bg-accent text-primary'
            : 'text-muted-foreground')
        }
      >
        <Link
          to={(image ? '/create/' : '/chat/') + row.id}
          onClick={onNavigate}
          className="flex h-full min-w-0 flex-1 items-center gap-2"
        >
          {row.pinned ? <Pin size={11} className="shrink-0" /> : null}
          <span className="truncate">
            {row.title || t(image ? 'images.untitled' : 'chat.untitled')}
          </span>
        </Link>
        {!image ? <ConversationActions row={{ ...row, busy: row.busy ?? false }} /> : null}
      </div>
    )
  }
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
        className="chat-sidebar-search mx-1 mb-3 flex items-center gap-2 rounded-lg border border-transparent px-2.5 focus-within:border-border focus-within:bg-card"
        onSubmit={(event) => {
          event.preventDefault()
          setSearches((state) => ({ ...state, [mode]: { ...state[mode], applied: search.trim() } }))
        }}
      >
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          data-history-search
          type="search"
          className="h-9 min-w-0 w-full bg-transparent text-base outline-none lg:text-xs"
          value={search}
          onChange={(event) =>
            setSearches((state) => ({
              ...state,
              [mode]: { ...state[mode], search: event.target.value },
            }))
          }
          maxLength={100}
          placeholder={t(image ? 'images.search' : 'chat.search')}
          aria-label={t(image ? 'images.search' : 'chat.search')}
        />
      </form>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ApiNotice error={query.error} />
        {!query.isPending && !rows.length ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t(image ? 'images.emptyHistory' : 'chat.empty')}
          </p>
        ) : null}
        {rows.length > 30 ? (
          <Suspense fallback={rows.slice(0, 12).map(historyRow)}>
            <VirtualHistoryRows
              keys={rowKeys}
              scroller={scroller}
              renderRow={(index) => {
                const row = rows[index]
                return row ? historyRow(row) : null
              }}
            />
          </Suspense>
        ) : (
          rows.map(historyRow)
        )}
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
