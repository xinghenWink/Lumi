import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { MessageSquare, Pin, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { chats } from '../../api/chat'
import { operations } from '../../api/operations'
import { useSession } from '../features/auth/hooks'
import { useTime } from '../features/accounts/time'
import { useRuntime } from '../app/context'
import { ConversationActions } from '../components/chat/ConversationActions'
import { ApiNotice } from '../components/shared/ApiNotice'
import { ModalDialog } from '../components/ui/modal-dialog'
import { Button } from '../components/ui/button'

export default function ChatHistoryPage() {
  const { t } = useTranslation(),
    time = useTime(),
    runtime = useRuntime()
  const { user } = useSession()
  const [search, setSearch] = useState(''),
    [applied, setApplied] = useState('')
  const [selected, setSelected] = useState<string[]>([]),
    [modal, setModal] = useState<'selected' | 'all' | ''>('')
  const query = useInfiniteQuery({
    queryKey: ['user', user?.id, 'sidebar-history', 'chat', applied],
    initialPageParam: '',
    enabled: !!user,
    queryFn: ({ pageParam, signal }) =>
      chats.list(new URLSearchParams({ search: applied, limit: '50', cursor: pageParam }), signal),
    getNextPageParam: (page) => page.next_cursor || undefined,
  })
  const rows = query.data?.pages.flatMap((page) => page.items) ?? []
  const exporting = useMutation({
    mutationFn: (format: 'json' | 'markdown') => operations.exportChats(format),
  })
  const removing = useMutation({
    mutationFn: ({ ids, all }: { ids: string[]; all: boolean }) => runtime.chat.remove(ids, all),
    onSuccess: () => {
      setSelected([])
      setModal('')
    },
  })
  return (
    <section className="chat-history mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('chat.history')}</h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">{t('chat.historyHint')}</p>
        </div>
        <Button asChild>
          <Link to="/chat">{t('chat.newChat')}</Link>
        </Button>
      </header>
      <form
        className="flex min-w-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied(search.trim())
          setSelected([])
        }}
      >
        <input
          type="search"
          aria-label={t('chat.search')}
          placeholder={t('chat.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={100}
          className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm"
        />
        <Button type="submit" variant="outline" disabled={query.isFetching}>
          {t('common.search')}
        </Button>
      </form>
      <ApiNotice error={query.error || exporting.error} />
      <div className="flex flex-wrap items-center gap-2">
        {(['json', 'markdown'] as const).map((format) => (
          <Button
            key={format}
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting.isPending}
            onClick={() => exporting.mutate(format)}
          >
            {t(format === 'json' ? 'ops.exportJSON' : 'ops.exportMarkdown')}
          </Button>
        ))}
        <span className="px-1 text-xs text-muted-foreground">
          {t('chat.selected', { count: selected.length })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selected.length}
          onClick={() => {
            removing.reset()
            setModal('selected')
          }}
        >
          <Trash2 size={13} />
          {t('chat.deleteSelected')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => {
            removing.reset()
            setModal('all')
          }}
        >
          {t('chat.clearAll')}
        </Button>
      </div>
      <div className="rounded-2xl border border-border bg-card">
        {query.isPending ? (
          <p role="status" className="p-10 text-center text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : !rows.length ? (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <MessageSquare size={28} className="text-primary" />
            <h2 className="text-base font-semibold">{t('chat.empty')}</h2>
            <p className="text-sm text-muted-foreground">{t('chat.emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex min-w-0 items-center gap-3 px-4 py-4 sm:px-5">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  aria-label={t('chat.select', { name: row.title || t('chat.untitled') })}
                  checked={selected.includes(row.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    )
                  }
                />
                <Link to={'/chat/' + row.id} className="min-w-0 flex-1">
                  <strong className="flex items-center gap-2 text-sm font-medium">
                    {row.pinned ? <Pin size={13} className="shrink-0 text-primary" /> : null}
                    <span className="truncate">{row.title || t('chat.untitled')}</span>
                  </strong>
                  <span className="mt-1.5 block text-[11px] text-muted-foreground">
                    {time(row.last_message_at)}
                  </span>
                </Link>
                <ConversationActions row={row} />
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <div className="border-t border-border p-3 text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage()
              }}
            >
              {t('chat.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
      <ModalDialog
        open={!!modal}
        onOpenChange={(value) => {
          if (!value) setModal('')
        }}
        title={t(modal === 'all' ? 'chat.clearTitle' : 'chat.deleteTitle')}
        description={t(modal === 'all' ? 'chat.clearHint' : 'chat.deleteHint')}
        busy={removing.isPending}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            removing.mutate({ ids: modal === 'all' ? [] : [...selected], all: modal === 'all' })
          }}
        >
          <ApiNotice error={removing.error} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={removing.isPending}
              onClick={() => setModal('')}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={removing.isPending}>
              {t('chat.confirmDelete')}
            </Button>
          </div>
        </form>
      </ModalDialog>
    </section>
  )
}
