import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCanvasCatalog } from '../../features/canvas/i18n'
import { useCanvasList } from '../../features/canvas/queries'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { CanvasActions } from './CanvasActions'

/** Recent canvases for the workspace sidebar; loaded only on canvas routes. */
export default function CanvasHistory({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const ready = useCanvasCatalog()
  const { t } = useTranslation()
  const location = useLocation()
  const [search, setSearch] = useState({ input: '', applied: '' })
  const query = useCanvasList(search.applied, 50, ready)
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  if (!ready) return null
  return (
    <>
      <div className="mb-1.5 flex items-center justify-between px-2.5 text-2xs font-medium text-muted-foreground">
        <span>{t('canvas.list.recent')}</span>
      </div>
      <form
        className="chat-sidebar-search mb-2 flex items-center gap-2 rounded-lg border border-transparent bg-muted/60 px-2.5 transition-colors focus-within:border-input focus-within:bg-card"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch((state) => ({ ...state, applied: state.input.trim() }))
        }}
      >
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          data-history-search
          type="search"
          className="h-8 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground lg:text-xs"
          value={search.input}
          onChange={(event) => setSearch((state) => ({ ...state, input: event.target.value }))}
          maxLength={100}
          placeholder={t('canvas.list.search')}
          aria-label={t('canvas.list.search')}
        />
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ApiNotice error={query.error} />
        {!query.isPending && !rows.length ? (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">{t('canvas.list.noRecent')}</p>
        ) : null}
        {rows.map((row) => (
          <div
            key={row.id}
            className={
              'chat-sidebar-row group/row flex h-9 items-center gap-1 rounded-lg pr-1 pl-2.5 text-[13px] transition-colors ' +
              (location.pathname === '/canvas/' + row.id
                ? 'bg-card font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground')
            }
          >
            <Link
              to={'/canvas/' + row.id}
              onClick={onNavigate}
              className="flex h-full min-w-0 flex-1 items-center"
            >
              <span className="truncate">{row.title || t('canvas.list.untitled')}</span>
            </Link>
            <CanvasActions row={row} />
          </div>
        ))}
        {query.hasNextPage ? (
          <Button
            type="button"
            className="mt-2 w-full"
            variant="ghost"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('canvas.list.loadMore')}
          </Button>
        ) : null}
      </div>
    </>
  )
}
