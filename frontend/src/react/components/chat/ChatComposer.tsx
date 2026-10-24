import { memo, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, ImagePlus, Square, X } from 'lucide-react'
import { useStore } from 'zustand'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { images } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useModels } from '../../features/catalog/models'
import { ApiNotice } from '../shared/ApiNotice'
import { ModelPicker } from '../catalog/ModelPicker'
import { Button } from '../ui/button'
import { ProtectedImage } from '../images/ProtectedImage'

const emptyReferences: string[] = []
// OpenAPI ChatSendInput caps references at four; vision support comes from the public catalog.
const referenceLimit = 4

function Reference({ id, onRemove }: { id: string; onRemove(): void }) {
  const { t } = useTranslation()
  const runtime = useRuntime()
  const owner = runtime.session.getSnapshot().user?.id
  const file = useQuery({
    queryKey: ['user', owner, 'file', id],
    queryFn: ({ signal }) => images.file(id, signal),
  })
  return (
    <div className="relative flex size-16 items-center justify-center rounded-xl border border-border bg-muted">
      {file.data ? (
        <ProtectedImage file={file.data} alt="" className="size-16 rounded-xl object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground">{t('images.loading')}</span>
      )}
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="absolute -top-1 -right-1 size-6 rounded-full"
        aria-label={t('ops.removeReference')}
        onClick={onRemove}
      >
        <X size={12} />
      </Button>
    </div>
  )
}

export const ChatComposer = memo(function ChatComposer({
  conversationId,
  busy,
}: {
  conversationId: string
  busy: boolean
}) {
  const { t } = useTranslation()
  const runtime = useRuntime()
  const navigate = useNavigate()
  const { selected } = useModels('chat')
  const text = useStore(runtime.chat.store, (state) => state.drafts[conversationId || 'new'] ?? '')
  const refs = useStore(
    runtime.chat.store,
    (state) => state.references[conversationId || 'new'] ?? emptyReferences,
  )
  const [pending, setPending] = useState(false),
    [uploading, setUploading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const uploadController = useRef<AbortController | null>(null)
  const composing = useRef(false)
  const field = useId()
  const vision = selected?.capabilities.vision === true
  useEffect(
    () => () => {
      uploadController.current?.abort()
    },
    [],
  )
  async function upload(file: File) {
    if (!vision || uploading) return
    if (refs.length >= referenceLimit) {
      setError(new ApiError('INVALID_INPUT'))
      return
    }
    const controller = new AbortController(),
      epoch = runtime.session.snapshot().epoch
    uploadController.current?.abort()
    uploadController.current = controller
    setUploading(true)
    setError(null)
    try {
      const uploaded = await images.upload(file, controller.signal)
      if (!controller.signal.aborted && epoch === runtime.session.snapshot().epoch) {
        const owner = runtime.session.getSnapshot().user?.id
        runtime.queryClient.setQueryData(['user', owner, 'file', uploaded.id], uploaded)
        const current = runtime.chat.store.getState().references[conversationId || 'new'] ?? []
        runtime.chat.references(conversationId, [...current, uploaded.id])
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure)
    } finally {
      if (!controller.signal.aborted) setUploading(false)
    }
  }
  async function send() {
    if (busy || pending || uploading || !text.trim() || !selected || (refs.length > 0 && !vision))
      return
    setPending(true)
    setError(null)
    const model = selected.id,
      draft = text,
      referenceIDs = [...refs]
    try {
      const id = conversationId || (await runtime.chat.create(model))
      await navigate('/chat/' + id, { replace: true })
      runtime.chat.draft(conversationId, '')
      runtime.chat.references(conversationId, [])
      void runtime.chat.send(id, {
        request_id: crypto.randomUUID(),
        model_id: model,
        content: draft,
        action: 'send',
        reference_file_ids: referenceIDs,
      })
    } catch (failure) {
      setError(failure)
    } finally {
      setPending(false)
    }
  }
  function enter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      !composing.current &&
      event.nativeEvent.keyCode !== 229
    ) {
      event.preventDefault()
      void send()
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send()
  }
  return (
    <section className="chat-composer-wrap mx-auto w-full max-w-4xl shrink-0 px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-8 sm:pb-5">
      <ApiNotice error={error} />
      <form
        className="chat-composer rounded-2xl border border-border bg-card p-3 shadow-sm focus-within:border-primary/40 sm:p-4"
        onSubmit={submit}
      >
        {refs.length ? (
          <div className="mb-3 flex flex-wrap gap-3 px-1 pt-1">
            {refs.map((id) => (
              <Reference
                key={id}
                id={id}
                onRemove={() =>
                  runtime.chat.references(
                    conversationId,
                    refs.filter((value) => value !== id),
                  )
                }
              />
            ))}
          </div>
        ) : null}
        {refs.length > 0 && !vision ? (
          <p role="status" className="mb-2 text-xs text-destructive">
            {t('react.visionRequired')}
          </p>
        ) : null}
        <textarea
          aria-label={t('chat.input')}
          placeholder={t('chat.placeholder')}
          value={text}
          onChange={(event) => runtime.chat.draft(conversationId, event.target.value)}
          rows={3}
          maxLength={64000}
          disabled={pending}
          className="min-h-20 w-full resize-none bg-transparent px-1 text-base leading-7 outline-none placeholder:text-muted-foreground sm:text-sm"
          onKeyDown={enter}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onPaste={(event) => {
            const file = event.clipboardData.files[0]
            if (vision && file) {
              event.preventDefault()
              void upload(file)
            }
          }}
        />
        <div className="mt-2 flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <ModelPicker kind="chat" disabled={pending || busy} />
          </div>
          {vision ? (
            <>
              <label
                htmlFor={field}
                className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted ${uploading || pending || refs.length >= referenceLimit ? 'pointer-events-none opacity-40' : ''}`}
                title={t('ops.reference')}
              >
                <ImagePlus size={18} />
                <span className="sr-only">{t('ops.reference')}</span>
              </label>
              <input
                id={field}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={uploading || pending || refs.length >= referenceLimit}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void upload(file)
                }}
              />
            </>
          ) : null}
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-9 rounded-full"
              aria-label={t('chat.stop')}
              onClick={() => {
                void runtime.chat.stop(conversationId)
              }}
            >
              <Square size={14} />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="size-9 rounded-full"
              aria-label={t('chat.send')}
              disabled={
                pending || uploading || !text.trim() || !selected || (refs.length > 0 && !vision)
              }
            >
              <ArrowUp size={18} />
            </Button>
          )}
        </div>
        <p className="mt-2 hidden px-1 text-[10px] text-muted-foreground sm:block">
          {t('chat.sendHint')}
        </p>
      </form>
    </section>
  )
})
