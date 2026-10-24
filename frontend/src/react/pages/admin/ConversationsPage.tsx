import { lazy, Suspense, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { operations, type ChatMetadata } from '../../../api/operations'
import { useSession } from '../../features/auth/hooks'
import { useCursorQuery } from '../../features/accounts/resources'
import { useTime } from '../../features/accounts/time'
import { AdminPage } from '../../components/admin/AdminPage'
import { DataTable } from '../../components/shared/DataTable'
import { CursorControls } from '../../components/shared/CursorControls'
import { ApiNotice } from '../../components/shared/ApiNotice'
import { PageStatus } from '../../components/shared/PageStatus'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { ModalDialog } from '../../components/ui/modal-dialog'

const Markdown = lazy(() =>
  import('../../components/shared/MarkdownContent').then((module) => ({
    default: module.MarkdownContent,
  })),
)
function MessageDetail({ row, onClose }: { row: ChatMetadata; onClose(): void }) {
  const { user } = useSession(),
    { t } = useTranslation(),
    time = useTime()
  const query = useInfiniteQuery({
    queryKey: ['user', user?.id, 'admin-chat-content', row.id, row.user_id],
    enabled: !!user,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => operations.messages(row.id, row.user_id, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor || undefined,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const messages = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <ModalDialog
      open
      wide
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('ops.viewContent')}
      description={t('ops.hiddenContent')}
    >
      <ApiNotice error={query.error} />
      {query.isPending ? (
        <PageStatus />
      ) : !query.data ? (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.retry')}
        </Button>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <article key={message.id} className="min-w-0 rounded-xl border border-border p-4">
              <header className="mb-3 flex justify-between gap-3 text-xs text-muted-foreground">
                <span>{t(message.role === 'user' ? 'admin.users.user' : 'chat.assistant')}</span>
                <time>{time(message.created_at)}</time>
              </header>
              <Suspense
                fallback={
                  <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                }
              >
                <Markdown content={message.content} />
              </Suspense>
            </article>
          ))}
          {!messages.length ? (
            <p className="text-xs text-muted-foreground">{t('common.empty')}</p>
          ) : null}
          {query.hasNextPage ? (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage()
              }}
            >
              {t('images.more')}
            </Button>
          ) : null}
        </div>
      )}
    </ModalDialog>
  )
}
function ConversationList({ initialOwner }: { initialOwner: string }) {
  const { user } = useSession(),
    { t } = useTranslation(),
    time = useTime(),
    [params, setParams] = useSearchParams()
  const [owner, setOwner] = useState(initialOwner),
    [selected, setSelected] = useState<ChatMetadata | null>(null)
  const query = useCursorQuery(
    ['user', user?.id, 'admin-conversations', initialOwner],
    (cursor, signal) =>
      operations.chats(new URLSearchParams({ user_id: initialOwner, cursor, limit: '40' }), signal),
    !!user,
  )
  return (
    <AdminPage
      title={t('nav.adminChats')}
      description={t('ops.hiddenContent')}
      actions={
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.refresh')}
        </Button>
      }
    >
      <form
        className="mb-5 flex gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setSelected(null)
          const next = new URLSearchParams(params)
          if (owner.trim()) next.set('user_id', owner.trim())
          else next.delete('user_id')
          setParams(next)
          query.reset()
          if (owner.trim() === initialOwner) void query.refetch()
        }}
      >
        <Input
          aria-label={t('ops.owner')}
          placeholder={t('ops.owner')}
          maxLength={36}
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        />
        <Button type="submit" variant="outline">
          {t('common.search')}
        </Button>
      </form>
      {query.isPending || query.isError ? (
        <PageStatus
          {...(query.error ? { error: query.error } : {})}
          retry={() => {
            void query.refetch()
          }}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {query.data?.items.length ? (
            <DataTable
              rows={query.data.items}
              columns={[
                {
                  key: 'id',
                  label: t('admin.users.id'),
                  render: (row) => (
                    <code className="block min-w-36 break-all text-[10px]">{row.id}</code>
                  ),
                },
                {
                  key: 'user',
                  label: t('ops.owner'),
                  render: (row) => (
                    <code className="block min-w-36 break-all text-[10px]">{row.user_id}</code>
                  ),
                },
                {
                  key: 'model',
                  label: t('images.model'),
                  render: (row) =>
                    row.model_id ? (
                      <code className="break-all text-[10px]">{row.model_id}</code>
                    ) : (
                      t('common.none')
                    ),
                },
                {
                  key: 'last',
                  label: t('ops.lastMessage'),
                  className: 'whitespace-nowrap',
                  render: (row) => time(row.last_message_at),
                },
                {
                  key: 'actions',
                  label: t('common.actions'),
                  render: (row) => (
                    <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                      {t('ops.viewContent')}
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <p className="p-8 text-center text-xs text-muted-foreground">{t('common.empty')}</p>
          )}
          <CursorControls
            page={query.page}
            nextCursor={query.data?.next_cursor ?? ''}
            loading={query.isFetching}
            onPrevious={query.previous}
            onNext={query.next}
          />
        </div>
      )}
      {selected ? (
        <MessageDetail key={selected.id} row={selected} onClose={() => setSelected(null)} />
      ) : null}
    </AdminPage>
  )
}
export default function ConversationsPage() {
  const [params] = useSearchParams()
  const owner = params.get('user_id') ?? ''
  return <ConversationList key={owner} initialOwner={owner} />
}
