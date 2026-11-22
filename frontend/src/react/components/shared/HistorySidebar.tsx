import { useInfiniteQuery } from '@tanstack/react-query'
import { Pin, Search } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { chats, type Conversation } from '../../../api/chat'
import { useSession } from '../../features/auth/hooks'
import { ApiNotice } from './ApiNotice'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
const ConversationActions = lazy(() => import('../chat/ConversationActions'))
const ImageConversationActions = lazy(() =>
  import('../images/ImageConversationActions').then((module) => ({
    default: module.ImageConversationActions,
  })),
)
const VirtualHistoryRows = lazy(() => import('./VirtualHistoryRows'))
// Canvas history carries its own lazily loaded copy, so it stays out of the shell bundle.
const CanvasHistory = lazy(() => import('../canvas/CanvasHistory'))

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
  const canvas = location.pathname === '/canvas' || location.pathname.startsWith('/canvas/')
  const mode = image ? 'image' : 'chat'
  const [searches, setSearches] = useState({
    chat: { search: '', applied: '' },
    image: { search: '', applied: '' },
  })
  const { search, applied } = searches[mode]
  const query = useInfiniteQuery({
    queryKey: ['user', user?.id, 'sidebar-history', image ? 'image' : 'chat', applied],
    initialPageParam: '',
    enabled: !!user && !canvas,
    queryFn: async ({ pageParam, signal }): Promise<HistoryPage> => {
      const params = new URLSearchParams({ search: applied, limit: '50', cursor: pageParam })
      if (!image) return chats.list(params, signal)
      const { images } = await import('../../../api/images')
      return images.conversations(params, signal)
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
          'chat-sidebar-row group/row flex h-9 items-center gap-1 rounded-lg pr-1 pl-2.5 text-[13px] transition-colors ' +
          (location.pathname.endsWith('/' + row.id)
            ? 'bg-card font-medium text-foreground shadow-xs'
            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground')
        }
      >
        <Link
          to={(image ? '/create/' : '/chat/') + row.id}
          onClick={onNavigate}
          className="flex h-full min-w-0 flex-1 items-center gap-2"
        >
          {row.pinned ? <Pin size={11} className="shrink-0 text-primary" /> : null}
          <span className="truncate">
            {row.title || t(image ? 'images.untitled' : 'chat.untitled')}
          </span>
        </Link>
        <Suspense fallback={null}>
          {image ? (
            <ImageConversationActions row={row} />
          ) : (
            <ConversationActions row={{ ...row, busy: row.busy ?? false }} />
          )}
        </Suspense>
      </div>
    )
  }
  if (canvas)
    return (
      <section className="flex min-h-0 flex-1 flex-col border-t border-border pt-3">
        <Suspense fallback={null}>
          <CanvasHistory onNavigate={onNavigate} />
        </Suspense>
      </section>
    )
  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border pt-3">
      <div className="mb-1.5 flex items-center justify-between px-2.5 text-2xs font-medium text-muted-foreground">
        <span>{t(image ? 'images.history' : 'react.recentChats')}</span>
        {!image ? (
          <Link
            to="/me/chats"
            onClick={onNavigate}
            className="rounded px-1 transition-colors hover:text-foreground"
            aria-label={t('nav.chatHistory')}
          >
            ···
          </Link>
        ) : null}
      </div>
      <form
        className="chat-sidebar-search mb-2 flex items-center gap-2 rounded-lg border border-transparent bg-muted/60 px-2.5 transition-colors focus-within:border-input focus-within:bg-card"
        onSubmit={(event) => {
          event.preventDefault()
          setSearches((state) => ({ ...state, [mode]: { ...state[mode], applied: search.trim() } }))
        }}
      >
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <Input
          data-history-search
          type="search"
          className="h-8 min-w-0 w-full rounded-none border-0 bg-transparent p-0 text-base shadow-none outline-none focus:ring-0 placeholder:text-muted-foreground lg:text-xs"
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
          <p className="px-2.5 py-3 text-xs text-muted-foreground">
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
