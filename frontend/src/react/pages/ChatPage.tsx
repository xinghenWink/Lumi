import { lazy, Suspense, useCallback, useEffect, useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../api/chat'
import { useRuntime } from '../app/context'
import { useModels } from '../features/catalog/models'
import { useChatTurnActions } from '../features/chat/actions'
import { ChatComposer } from '../components/chat/ChatComposer'
import { ModeTabs } from '../components/chat/ModeTabs'
import { ApiNotice } from '../components/shared/ApiNotice'
import { BrandMark } from '../components/shared/BrandMark'
import { PageStatus } from '../components/shared/PageStatus'
import { ModalDialog } from '../components/ui/modal-dialog'
import { Button } from '../components/ui/button'
import { textareaClass } from '../components/ui/field'
const ConversationActions = lazy(() => import('../components/chat/ConversationActions'))
const MessageList = lazy(() =>
  import('../components/chat/MessageList').then((module) => ({ default: module.MessageList })),
)

export default function ChatPage() {
  const { id = '' } = useParams()
  const runtime = useRuntime()
  const chat = runtime.chat
  const { t } = useTranslation()
  const editField = useId()
  const data = useQuery(chat.options(id))
  const modelQuery = useModels('chat')
  const selected = modelQuery.selected?.id
  const modelId = data.data?.conversation.model_id
  const available = modelQuery.query.data?.items
  const running = useStore(chat.store, (state) => !!state.running[id])
  const error = useStore(chat.store, (state) => state.errors[id])
  const pending = useStore(chat.store, (state) => state.pending[id])
  const [editing, setEditing] = useState<Message | null>(null),
    [edited, setEdited] = useState('')
  const busy = running || !!data.data?.conversation.busy
  const older = useMutation({ mutationFn: () => chat.loadOlder(id) })
  const { regenerate, resend } = useChatTurnActions(id, selected)
  useEffect(() => {
    void chat.open(id)
  }, [chat, id])
  useEffect(() => {
    if (modelId && available?.some((model) => model.id === modelId))
      runtime.modelStore.getState().select('chat', modelId)
  }, [available, id, modelId, runtime])
  const edit = useCallback((message: Message) => {
    setEditing(message)
    setEdited(message.content)
  }, [])
  async function loadOlder() {
    await older.mutateAsync().catch(() => undefined)
  }
  function editSend() {
    if (!editing || busy || !edited.trim()) return
    const message = editing
    setEditing(null)
    resend(message, edited)
  }
  const messages = data.data?.messages.length ?? 0
  const loading = !!id && data.isPending
  // The welcome layout keeps the composer at the same tree position so typing state survives.
  const hero = !loading && !data.isError && !messages && !busy && !pending
  return (
    <div
      className="chat-page relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-hero={hero || undefined}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-3 sm:px-6">
        <ModeTabs />
        {data.data ? (
          <div className="chat-current-title flex min-w-0 items-center gap-1">
            <span className="truncate text-xs text-muted-foreground">
              {data.data.conversation.title || t('chat.untitled')}
            </span>
            <Suspense fallback={null}>
              <ConversationActions row={data.data.conversation} />
            </Suspense>
          </div>
        ) : null}
      </div>
      <ApiNotice error={older.error} />
      {loading ? (
        <PageStatus />
      ) : id && data.isError ? (
        <PageStatus
          error={data.error}
          retry={() => {
            void data.refetch()
          }}
        />
      ) : messages && data.data ? (
        <Suspense fallback={<PageStatus />}>
          <MessageList
            key={id}
            items={data.data.messages}
            busy={busy}
            hasOlder={!!data.data.nextCursor}
            loadingOlder={older.isPending}
            onOlder={loadOlder}
            onEdit={edit}
            onRegenerate={regenerate}
          />
        </Suspense>
      ) : (
        <section className="flex min-h-min flex-1 flex-col items-center justify-end px-5 pt-4 pb-4 text-center sm:pb-8">
          <div className="mb-3 animate-rise-in sm:mb-5">
            <BrandMark compact markClassName="size-12" />
          </div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-[32px]">
            {t('react.title')}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            {t('chat.description')}
          </p>
        </section>
      )}
      {error ? (
        <div className="chat-stream-error mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 sm:px-6">
          <ApiNotice error={error} />
          {pending && !running ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => {
                void chat.retryPending(id)
              }}
            >
              <RotateCw size={13} />
              {t('chat.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!id || !data.isError ? (
        <ChatComposer
          key={id || 'new'}
          conversationId={id}
          busy={busy}
          variant={hero ? 'hero' : 'dock'}
        />
      ) : null}
      {hero ? <div aria-hidden="true" className="min-h-3 flex-[1.4] sm:min-h-6" /> : null}
      <ModalDialog
        open={!!editing}
        onOpenChange={(value) => {
          if (!value) setEditing(null)
        }}
        title={t('chat.editTitle')}
        description={t('chat.editHint')}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            editSend()
          }}
        >
          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor={editField} className="text-xs font-medium">
              {t('chat.input')}
            </label>
            <textarea
              id={editField}
              value={edited}
              onChange={(event) => setEdited(event.target.value)}
              rows={6}
              maxLength={64000}
              required
              autoFocus
              onFocus={(event) => {
                const end = event.currentTarget.value.length
                event.currentTarget.setSelectionRange(end, end)
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  editSend()
                }
              }}
              className={textareaClass + ' resize-none leading-7'}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!edited.trim() || busy}>
              {t('chat.saveEdit')}
            </Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  )
}
