import { useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Film } from 'lucide-react'
import { credits } from '../../api/credits'
import { videoAPI, videoPending, type VideoInput } from '../../api/videos'
import { useSession } from '../features/auth/hooks'
import { ApiNotice } from '../components/shared/ApiNotice'
import { Button } from '../components/ui/button'
import { VideoComposer } from '../components/videos/VideoComposer'
import { VideoPlayer } from '../components/videos/VideoPlayer'
import { Card, CardContent } from '../components/ui/card'

export default function VideoPage() {
  const { t, i18n } = useTranslation()
  const { user } = useSession()
  const client = useQueryClient()
  const [draft, setDraft] = useState<{ input: VideoInput; key: string; autoQuote: boolean }>()
  const [generation, setGeneration] = useState(0)
  const key = ['user', user?.id, 'video-tasks']
  const tasks = useInfiniteQuery({
    queryKey: key,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => videoAPI.tasks(pageParam, signal),
    getNextPageParam: (page) => page.next_cursor || undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((task) => videoPending(task.status)))
        ? 3000
        : false,
    enabled: Boolean(user),
  })
  const wallet = useQuery({
    queryKey: ['user', user?.id, 'video-credit-pool'],
    queryFn: ({ signal }) => videoAPI.pool(signal),
    enabled: Boolean(user),
  })
  const balance = useQuery({
    queryKey: ['user', user?.id, 'video-credit-balance'],
    queryFn: ({ signal }) => credits.account(undefined, signal),
    refetchInterval: tasks.data?.pages.some((page) =>
      page.items.some((task) => videoPending(task.status)),
    )
      ? 6000
      : false,
    enabled: Boolean(user),
  })
  const rows = tasks.data?.pages.flatMap((page) => page.items) ?? []
  function edit(input: VideoInput, autoQuote = false) {
    setDraft({ input, autoQuote, key: crypto.randomUUID() })
    document.getElementById('video-composer')?.scrollIntoView({ block: 'start' })
  }
  return (
    <main className="mx-auto grid w-full max-w-5xl content-start gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Film className="size-5 text-primary" />
          {t('video.title')}
        </h1>
        {wallet.data && balance.data ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t(wallet.data.pool === 'video' ? 'video.videoPool' : 'video.permanentPool')}
            </span>
            <span className="rounded-full bg-muted px-3 py-1">
              {t('video.balance', {
                amount:
                  wallet.data.pool === 'video'
                    ? (balance.data.video_balance ?? 0)
                    : balance.data.permanent_balance,
              })}
            </span>
          </div>
        ) : null}
      </header>
      <div id="video-composer">
        <VideoComposer
          key={draft?.key ?? generation}
          {...(draft ? { initial: draft.input, autoQuote: draft.autoQuote } : {})}
          onSubmitted={() => {
            void client.invalidateQueries({ queryKey: key })
            void client.invalidateQueries({ queryKey: ['user', user?.id, 'video-credit-balance'] })
            void client.invalidateQueries({ queryKey: ['user', user?.id, 'credits'] })
            setDraft(undefined)
            setGeneration((value) => value + 1)
          }}
        />
      </div>
      <section aria-label={t('video.history')} className="grid gap-3">
        <h2 className="text-base font-semibold">{t('video.history')}</h2>
        <ApiNotice error={tasks.error} />
        {tasks.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : null}
        {!tasks.isPending && !rows.length ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            {t('video.noHistory')}
          </div>
        ) : null}
        {rows.map((task) => (
          <Card key={task.id} className="py-4">
            <CardContent className="grid gap-3 px-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <strong>{task.model_name}</strong>
                <span className="text-muted-foreground">
                  {t('video.' + task.status)} · {new Date(task.created_at).toLocaleString()}
                </span>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
                {task.input.prompt.replace(/@\[[A-Za-z0-9_-]{1,50}\]/g, '@')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {task.items.map((item) =>
                  item.file_id ? (
                    <VideoPlayer key={item.position} fileId={item.file_id} />
                  ) : (
                    <div
                      key={item.position}
                      className="grid min-h-16 content-center rounded-lg bg-muted px-3 text-sm text-muted-foreground"
                    >
                      <span>
                        {t('video.resultCount', { index: item.position + 1 })} ·{' '}
                        {t('video.' + item.status)}
                      </span>
                      {item.error_code && i18n.exists('errors.' + item.error_code) ? (
                        <span>{t('errors.' + item.error_code)}</span>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t('video.cost', { amount: task.quote.total_cost - task.refunded })}</span>
                {task.refunded > 0 ? (
                  <span>{t('video.refunded', { amount: task.refunded })}</span>
                ) : null}
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => edit(task.input)}>
                    {t('video.edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => edit(task.input, true)}
                  >
                    {t('video.regenerate')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {tasks.hasNextPage ? (
          <Button variant="outline" className="w-fit" onClick={() => void tasks.fetchNextPage()}>
            {t('video.loadMore')}
          </Button>
        ) : null}
      </section>
    </main>
  )
}
