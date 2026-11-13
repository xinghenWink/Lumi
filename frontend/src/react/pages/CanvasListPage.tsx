import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Workflow } from 'lucide-react'
import type { CanvasSummary } from '../../api/canvases'
import { useTime } from '../features/accounts/time'
import { useCanvasCatalog } from '../features/canvas/i18n'
import { useCanvasList } from '../features/canvas/queries'
import { CanvasActions } from '../components/canvas/CanvasActions'
import { ProtectedImage } from '../components/images/ProtectedImage'
import { ApiNotice } from '../components/shared/ApiNotice'
import { PageStatus } from '../components/shared/PageStatus'
import { Button } from '../components/ui/button'

const SEARCH_DELAY = 300

function CanvasCard({ row }: { row: CanvasSummary }) {
  const { t } = useTranslation()
  const time = useTime()
  const title = row.title || t('canvas.list.untitled')
  return (
    <li
      data-testid="canvas-card"
      className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-shadow hover:shadow-md"
    >
      <Link
        to={'/canvas/' + row.id}
        aria-label={t('canvas.list.open', { title })}
        className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-size-[16px_16px]">
          {row.cover ? (
            <ProtectedImage
              file={row.cover}
              alt=""
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <span className="grid size-12 place-items-center rounded-2xl bg-card text-primary shadow-xs">
              <Workflow size={22} />
            </span>
          )}
        </div>
        <div className="min-w-0 px-3.5 pt-3 pb-3.5 pr-12">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {t('canvas.list.nodes', { count: row.node_count })}
            {' · '}
            {t('canvas.list.updated', { time: time(row.updated_at) })}
          </p>
        </div>
      </Link>
      <CanvasActions row={row} className="absolute right-2 bottom-3" />
    </li>
  )
}

function CanvasList() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [input])
  const query = useCanvasList(search)
  const rows = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
      <header className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">{t('canvas.list.heading')}</h1>
          <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground">
            {t('canvas.list.description')}
          </p>
        </div>
        <Button asChild>
          <Link to="/canvas/new">
            <Plus size={16} />
            {t('canvas.list.new')}
          </Link>
        </Button>
      </header>
      <label className="mb-5 flex h-10 w-full max-w-sm shrink-0 items-center gap-2 rounded-lg border border-input bg-card px-3 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15">
        <Search size={15} className="shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={input}
          maxLength={100}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('canvas.list.search')}
          aria-label={t('canvas.list.search')}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        />
      </label>
      <ApiNotice error={query.error} />
      {query.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      ) : !rows.length ? (
        <div className="grid flex-1 place-content-center gap-3 py-10 text-center text-muted-foreground">
          <span className="mx-auto mb-1 grid size-12 place-items-center rounded-2xl bg-accent text-primary">
            <Workflow size={22} />
          </span>
          <h2 className="text-base font-medium text-foreground">{t('canvas.list.empty')}</h2>
          <p className="text-sm">{t('canvas.list.emptyHint')}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4">
          {rows.map((row) => (
            <CanvasCard key={row.id} row={row} />
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="mx-auto mt-6"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('canvas.list.loadMore')}
        </Button>
      ) : null}
    </div>
  )
}

export default function CanvasListPage() {
  const ready = useCanvasCatalog()
  return ready ? <CanvasList /> : <PageStatus />
}
