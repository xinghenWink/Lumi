import { lazy, memo, Suspense, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, ImagePlus, Square } from 'lucide-react'
import { useStore } from 'zustand'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useModels } from '../../features/catalog/models'
import { useFileDrop } from '../../features/files/drop'
import { referenceAccept } from '../../features/files/reference-rules'
import { useReferenceUploads } from '../../features/files/reference-uploads'
import { useImageConfig } from '../../features/images/config'
import { useAutosize } from '../../lib/autosize'
import { cn } from '../../lib/utils'
import { ApiNotice } from '../shared/ApiNotice'
import { ModelPicker } from '../catalog/ModelPicker'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '../ui/input-group'
import { Button } from '../ui/button'

const ReferenceTray = lazy(() =>
  import('../shared/ReferenceTray').then((module) => ({ default: module.ReferenceTray })),
)
const UploadNotice = lazy(() =>
  import('../shared/ReferenceTray').then((module) => ({ default: module.UploadNotice })),
)

const emptyReferences: string[] = []
// OpenAPI ChatSendInput caps references at four; vision support comes from the public catalog.
const referenceLimit = 4
const suggestions = [
  'react.chatSuggestions.explain',
  'react.chatSuggestions.write',
  'react.chatSuggestions.plan',
  'react.chatSuggestions.code',
] as const

export const ChatComposer = memo(function ChatComposer({
  conversationId,
  busy,
  variant = 'dock',
}: {
  conversationId: string
  busy: boolean
  variant?: 'hero' | 'dock'
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const composing = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const hero = variant === 'hero'
  const vision = selected?.capabilities.vision === true
  const maxBytes = useImageConfig(vision).data?.max_upload_bytes
  useAutosize(textarea, text, hero ? 320 : 240)
  const upload = useReferenceUploads({
    ids: refs,
    limit: referenceLimit,
    maxBytes,
    enabled: vision && !pending,
    commit(file) {
      const current = runtime.chat.store.getState().references[conversationId || 'new'] ?? []
      if (current.includes(file.id)) return
      if (current.length >= referenceLimit) throw new ApiError('INVALID_INPUT')
      runtime.chat.references(conversationId, [...current, file.id])
    },
  })
  const full = upload.used >= referenceLimit
  const attachable = vision && !pending && !full
  const size = maxBytes ? (maxBytes / 1_048_576).toLocaleString() : ''
  const dragging = useFileDrop({
    enabled: attachable,
    title: !vision
      ? t('react.dropVisionRequired')
      : pending
        ? t('react.dropLocked')
        : full
          ? t('react.dropFull', { max: referenceLimit })
          : t('react.dropTitle'),
    hint:
      attachable && size ? t('react.dropHint', { size, count: referenceLimit - upload.used }) : '',
    onFiles: (files) => upload.uploads.add(files),
  })
  const blocked =
    pending || upload.busy || !text.trim() || !selected || (refs.length > 0 && !vision)
  async function send() {
    if (busy || blocked || !selected) return
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
  function suggest(value: string) {
    runtime.chat.draft(conversationId, value)
    requestAnimationFrame(() => {
      const element = textarea.current
      if (!element) return
      element.focus()
      element.setSelectionRange(value.length, value.length)
    })
  }
  return (
    <section
      className={cn(
        'chat-composer-wrap mx-auto shrink-0',
        hero
          ? 'w-full max-w-2xl px-4'
          : 'w-full max-w-3xl px-3 pt-1 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4',
      )}
    >
      <ApiNotice error={error} />
      <form onSubmit={submit}>
        <InputGroup
          className={cn(
            'chat-composer relative mt-2 rounded-3xl border border-input bg-card shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-ring/45 focus-within:shadow-md',
            hero && 'shadow-md',
            dragging && attachable && 'border-primary/60 ring-4 ring-primary/10',
          )}
        >
          {upload.used ? (
            <InputGroupAddon
              align="block-start"
              className="flex-col items-stretch gap-0 px-0 pt-0 pb-0"
            >
              <Suspense>
                <ReferenceTray
                  ids={refs}
                  items={upload.items}
                  previews={upload.previews}
                  disabled={pending}
                  className="px-3 pt-3"
                  onRemove={(id) =>
                    runtime.chat.references(
                      conversationId,
                      refs.filter((value) => value !== id),
                    )
                  }
                  onRetry={(key) => upload.uploads.retry(key)}
                  onCancel={(key) => upload.uploads.cancel(key)}
                />
              </Suspense>
              {refs.length > 0 && !vision ? (
                <p role="status" className="px-4 pt-3 text-xs text-destructive">
                  {t('react.visionRequired')}
                </p>
              ) : null}
            </InputGroupAddon>
          ) : null}
          <InputGroupTextarea
            ref={textarea}
            aria-label={t('chat.input')}
            placeholder={t('chat.placeholder')}
            value={text}
            onChange={(event) => runtime.chat.draft(conversationId, event.target.value)}
            rows={hero ? 3 : 1}
            maxLength={64000}
            disabled={pending}
            className={cn(
              'block w-full flex-none field-sizing-fixed resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-7 outline-none placeholder:text-muted-foreground sm:text-[15px]',
              hero ? 'min-h-24' : 'min-h-[52px]',
            )}
            onKeyDown={enter}
            onCompositionStart={() => {
              composing.current = true
            }}
            onCompositionEnd={() => {
              composing.current = false
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (vision && files.length) {
                event.preventDefault()
                upload.uploads.add(files)
              }
            }}
          />
          <InputGroupAddon align="block-end" className="min-w-0 gap-1 px-2 pt-1 pb-2">
            <InputGroupButton
              type="button"
              size="icon-sm"
              disabled={!attachable}
              aria-label={t('ops.reference')}
              title={vision ? t('ops.reference') : t('react.dropVisionRequired')}
              className="size-9 rounded-full"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus size={18} />
            </InputGroupButton>
            <input
              ref={fileInput}
              tabIndex={-1}
              type="file"
              accept={referenceAccept}
              multiple
              hidden
              disabled={!attachable}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                upload.uploads.add(files)
              }}
            />
            {vision && upload.used ? (
              <span className="shrink-0 pr-1 text-2xs text-muted-foreground tabular-nums">
                <span aria-hidden="true">
                  {t('react.referenceSlots', { count: upload.used, max: referenceLimit })}
                </span>
                <span className="sr-only">
                  {t('react.referenceSlotsLabel', { count: upload.used, max: referenceLimit })}
                </span>
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <ModelPicker kind="chat" disabled={pending || busy} />
            </div>
            {busy ? (
              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="secondary"
                className="size-9 rounded-full"
                aria-label={t('chat.stop')}
                onClick={() => {
                  void runtime.chat.stop(conversationId)
                }}
              >
                <Square size={13} fill="currentColor" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                className="size-9 rounded-full"
                aria-label={t('chat.send')}
                disabled={blocked}
              >
                <ArrowUp size={18} strokeWidth={2.2} />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      {upload.notice ? (
        <Suspense>
          <UploadNotice notice={upload.notice} size={size} className="mt-2 px-2" />
        </Suspense>
      ) : null}
      {hero ? (
        <div className="mt-4 sm:mt-6">
          <p className="mb-2 text-center text-xs text-muted-foreground sm:mb-3">
            {t('react.suggestions')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((key) => (
              <Button
                variant="outline"
                size="sm"
                key={key}
                type="button"
                className="rounded-full px-3.5 text-muted-foreground hover:text-foreground"
                onClick={() => suggest(t(key))}
              >
                {t(key)}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 hidden text-center text-2xs text-muted-foreground sm:block">
          {t('chat.sendHint')}
        </p>
      )}
    </section>
  )
})
