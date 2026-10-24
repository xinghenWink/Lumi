import { lazy, Suspense, useCallback, useEffect, useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../api/chat'
import { lastMessage } from '../../features/chat/messages'
import { useRuntime } from '../app/context'
import { useModels } from '../features/catalog/models'
import { ChatComposer } from '../components/chat/ChatComposer'
import { ModeTabs } from '../components/chat/ModeTabs'
import { ConversationActions } from '../components/chat/ConversationActions'
import { ApiNotice } from '../components/shared/ApiNotice'
import { PageStatus } from '../components/shared/PageStatus'
import { ModalDialog } from '../components/ui/modal-dialog'
import { Button } from '../components/ui/button'
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
  const regenerate = useCallback(() => {
    const snapshot = chat.snapshot(id)
    const last = snapshot && lastMessage(snapshot.messages, 'user')
    if (id && last && selected)
      void chat.send(id, {
        request_id: crypto.randomUUID(),
        model_id: selected,
        action: 'regenerate',
        content: '',
        last_message_id: last.id,
      })
  }, [chat, id, selected])
  async function loadOlder() {
    await older.mutateAsync().catch(() => undefined)
  }
  function editSend() {
    if (!editing || !id || !selected || !edited.trim() || busy) return
    setEditing(null)
    void chat.send(id, {
      request_id: crypto.randomUUID(),
      model_id: selected,
      action: 'edit',
      content: edited,
      last_message_id: editing.id,
    })
  }
  return (
    <div className="chat-page flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <ModeTabs />
        {data.data ? (
          <div className="chat-current-title flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {data.data.conversation.title || t('chat.untitled')}
            </span>
            <ConversationActions row={data.data.conversation} />
          </div>
        ) : null}
      </div>
      <ApiNotice error={older.error} />
      {id && data.isPending ? (
        <PageStatus />
      ) : id && data.isError ? (
        <PageStatus
          error={data.error}
          retry={() => {
            void data.refetch()
          }}
        />
      ) : data.data?.messages.length ? (
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
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-5 py-8 text-center">
          <span className="mb-2 grid size-14 place-items-center rounded-2xl bg-accent text-primary">
            <Sparkles size={28} strokeWidth={1.5} />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('react.title')}</h1>
          <p className="max-w-md text-sm leading-7 text-muted-foreground">
            {t('chat.description')}
          </p>
        </section>
      )}
      {error ? (
        <div className="chat-stream-error mx-auto w-full max-w-4xl px-4">
          <ApiNotice error={error} />
          {pending && !running ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void chat.retryPending(id)
              }}
            >
              {t('chat.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!id || !data.isError ? (
        <ChatComposer key={id || 'new'} conversationId={id} busy={busy} />
      ) : null}
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
          <div className="flex flex-col gap-2 text-sm">
            <label htmlFor={editField}>{t('chat.input')}</label>
            <textarea
              id={editField}
              value={edited}
              onChange={(event) => setEdited(event.target.value)}
              rows={6}
              maxLength={64000}
              required
              className="w-full rounded-xl border border-border bg-background p-3 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm"
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
