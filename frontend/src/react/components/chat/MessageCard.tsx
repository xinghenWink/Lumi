import { Copy, Pencil, RefreshCw, Sparkles } from 'lucide-react'
import { lazy, memo, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../../api/chat'
import { Button } from '../ui/button'

const Markdown = lazy(() =>
  import('../shared/MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
)
const References = lazy(() => import('./ChatReferences'))

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
  const user = message.role === 'user'
  return (
    <article
      className={`chat-message chat-message-${message.role} mx-auto flex w-full max-w-3xl flex-col ${user ? 'items-end' : 'items-start'} py-5`}
      data-message-id={message.id}
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {!user ? <Sparkles size={16} className="text-primary" /> : null}
        {t(user ? 'chat.you' : 'chat.assistant')}
      </div>
      <div
        className={
          user ? 'max-w-full rounded-2xl rounded-tr-sm bg-accent px-4 py-3' : 'min-w-0 w-full'
        }
      >
        {user ? (
          <p className="chat-user-text whitespace-pre-wrap break-words text-sm leading-7">
            {message.content}
          </p>
        ) : (
          <>
            {message.content ? (
              <Suspense
                fallback={
                  <p className="whitespace-pre-wrap break-words text-sm leading-7">
                    {message.content}
                  </p>
                }
              >
                <Markdown content={message.content} complete={message.status !== 'streaming'} />
              </Suspense>
            ) : message.status === 'streaming' ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('chat.waiting')}
              </p>
            ) : null}
            {message.status === 'error' || message.status === 'interrupted' ? (
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
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
          </>
        )}
        {message.reference_file_ids?.length ? (
          <Suspense>
            <References ids={message.reference_file_ids} />
          </Suspense>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-1">
        {message.content ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t(copied ? 'chat.copied' : 'chat.copy')}
            onClick={() => {
              void navigator.clipboard
                .writeText(message.content)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }}
          >
            <Copy size={14} />
          </Button>
        ) : null}
        {lastUser ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={busy}
            aria-label={t('chat.edit')}
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
            className="size-8"
            disabled={busy}
            aria-label={t(message.status === 'completed' ? 'chat.regenerate' : 'chat.retry')}
            onClick={onRegenerate}
          >
            <RefreshCw size={14} />
          </Button>
        ) : null}
        {message.meta.usage ? (
          <span className="ml-2 text-[10px] text-muted-foreground">
            {t('chat.tokens', { count: message.meta.usage.total_tokens })}
          </span>
        ) : null}
      </div>
    </article>
  )
})
