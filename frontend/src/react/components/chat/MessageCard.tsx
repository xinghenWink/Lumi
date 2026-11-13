import { Check, Copy, Pencil, RefreshCw, Sparkles } from 'lucide-react'
import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../../api/chat'
import type { Illustration } from '../../../features/chat/markdown'
import { useRuntime } from '../../app/context'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

const Markdown = lazy(() =>
  import('../shared/MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
)
const References = lazy(() => import('./ChatReferences'))

function Typing() {
  const { t } = useTranslation()
  return (
    <p role="status" className="flex h-7 items-center gap-1">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className="size-1.5 rounded-full bg-muted-foreground animate-typing"
          style={{ animationDelay: index * 160 + 'ms' }}
        />
      ))}
      <span className="sr-only">{t('chat.waiting')}</span>
    </p>
  )
}

export const MessageCard = memo(function MessageCard({
  message,
  lastUser,
  lastAssistant,
  busy,
  onEdit,
  onRegenerate,
}: {
  message: Message
  lastUser: boolean
  lastAssistant: boolean
  busy: boolean
  onEdit(message: Message): void
  onRegenerate(): void
}) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const runtime = useRuntime(),
    navigate = useNavigate()
  // A suggested illustration opens the studio with its prompt; generating stays the user's choice.
  const illustrate = useCallback(
    ({ prompt, ratio }: Illustration) => {
      runtime.image.draft('', { prompt, ratio, size: '' })
      void navigate('/create')
    },
    [runtime, navigate],
  )
  const user = message.role === 'user'
  const streaming = message.status === 'streaming'
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const actions = (
    <div
      className={cn(
        'mt-1.5 flex items-center gap-0.5',
        user ? 'justify-end' : '-ml-2',
        // The latest answer keeps its actions visible; older turns reveal them on hover or focus.
        !(lastAssistant && !streaming) && 'reveal-on-hover',
      )}
    >
      {message.content ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          aria-label={t(copied ? 'chat.copied' : 'chat.copy')}
          title={t(copied ? 'chat.copied' : 'chat.copy')}
          onClick={() => {
            void navigator.clipboard
              .writeText(message.content)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </Button>
      ) : null}
      {lastUser ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          disabled={busy}
          aria-label={t('chat.edit')}
          title={t('chat.edit')}
          onClick={() => onEdit(message)}
        >
          <Pencil size={14} />
        </Button>
      ) : null}
      {lastAssistant ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          disabled={busy}
          aria-label={t(message.status === 'completed' ? 'chat.regenerate' : 'chat.retry')}
          title={t(message.status === 'completed' ? 'chat.regenerate' : 'chat.retry')}
          onClick={onRegenerate}
        >
          <RefreshCw size={14} />
        </Button>
      ) : null}
      {message.meta.usage ? (
        <span className="ml-1.5 text-2xs text-muted-foreground tabular-nums">
          {t('chat.tokens', { count: message.meta.usage.total_tokens })}
        </span>
      ) : null}
    </div>
  )
  return (
    <article
      className={cn(
        'chat-message group mx-auto flex w-full max-w-3xl py-3',
        'chat-message-' + message.role,
        user ? 'flex-col items-end' : 'gap-3.5',
      )}
      data-message-id={message.id}
    >
      {user ? (
        <>
          <span className="sr-only">{t('chat.you')}</span>
          <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-bubble px-4 py-2.5">
            <p className="chat-user-text text-message break-words whitespace-pre-wrap">
              {message.content}
            </p>
          </div>
          {message.reference_file_ids?.length ? (
            <Suspense>
              <References ids={message.reference_file_ids} />
            </Suspense>
          ) : null}
          {actions}
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-primary',
              streaming && 'animate-pulse',
            )}
          >
            <Sparkles size={15} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="sr-only">{t('chat.assistant')}</span>
            {message.content ? (
              <Suspense
                fallback={
                  <p className="text-message break-words whitespace-pre-wrap">{message.content}</p>
                }
              >
                <Markdown
                  content={message.content}
                  complete={!streaming}
                  onIllustration={illustrate}
                />
              </Suspense>
            ) : streaming ? (
              <Typing />
            ) : null}
            {message.status === 'error' || message.status === 'interrupted' ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs leading-5 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    message.status === 'error' ? 'bg-destructive' : 'bg-warning',
                  )}
                />
                {t(message.status === 'error' ? 'chat.error' : 'chat.interrupted')}
                {message.meta.error_code
                  ? ' · ' +
                    t(
                      i18n.exists('errors.' + message.meta.error_code)
                        ? 'errors.' + message.meta.error_code
                        : 'errors.UNKNOWN_ERROR',
                    )
                  : null}
              </p>
            ) : null}
            {message.reference_file_ids?.length ? (
              <Suspense>
                <References ids={message.reference_file_ids} />
              </Suspense>
            ) : null}
            {actions}
          </div>
        </>
      )}
    </article>
  )
})
