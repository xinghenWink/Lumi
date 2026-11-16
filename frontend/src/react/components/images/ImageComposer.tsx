import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, ImagePlus, Images, Plus, RotateCw, SlidersHorizontal } from 'lucide-react'
import { useStore } from 'zustand'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ImageFile, ImageInput } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useImageController } from '../../features/images/use-image-controller'
import { useRuntime } from '../../app/context'
import { useFileDrop } from '../../features/files/drop'
import { referenceAccept } from '../../features/files/reference-rules'
import { useReferenceUploads } from '../../features/files/reference-uploads'
import { emptyImageDraft, imageSubmissionScope } from '../../features/images/controller'
import { useImageOptions } from '../../features/images/options'
import { useAutosize } from '../../lib/autosize'
import { cn } from '../../lib/utils'
import { ApiNotice } from '../shared/ApiNotice'
import { ReferenceTray, UploadNotice } from '../shared/ReferenceTray'
import { ModelPicker } from '../catalog/ModelPicker'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { ImageParameters } from './ImageParameters'
const ImageLibrary = lazy(() =>
  import('./ImageLibrary').then((module) => ({ default: module.ImageLibrary })),
)

/**
 * Image prompt, references and parameters. `panel` is the desktop studio sidebar with
 * always-visible parameters; `dock` is the compact bottom composer with a parameter sheet.
 */
export function ImageComposer({
  conversationId,
  layout = 'dock',
}: {
  conversationId: string
  layout?: 'panel' | 'dock'
}) {
  const runtime = useRuntime()
  const controller = useImageController(),
    { t } = useTranslation(),
    navigate = useNavigate()
  const scope = useStore(controller.store, (state) => imageSubmissionScope(state, conversationId))
  const draft = useStore(controller.store, (state) => state.drafts[scope] ?? emptyImageDraft)
  const pending = useStore(controller.store, (state) => state.pending[scope])
  const sending = useStore(controller.store, (state) => !!state.sending[scope])
  const error = useStore(controller.store, (state) => state.errors[scope])
  const options = useImageOptions(draft)
  const [library, setLibrary] = useState(false),
    [sheet, setSheet] = useState(false)
  const [localError, setLocalError] = useState<unknown>(null)
  const picker = useRef<HTMLInputElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false)
  const id = useId()
  const panel = layout === 'panel'
  const locked = sending || !!pending
  const maxBytes = options.config.data?.max_upload_bytes
  const size = maxBytes ? (maxBytes / 1_048_576).toLocaleString() : ''
  useAutosize(textarea, draft.prompt, panel ? 260 : 200)
  useEffect(() => {
    if (draft.references.length) textarea.current?.focus()
  }, [draft.references.length])
  function patch(value: Parameters<typeof controller.draft>[1]) {
    controller.draft(conversationId, value)
  }
  function attach(file: ImageFile) {
    const current = controller.store.getState().drafts[scope] ?? emptyImageDraft
    if (current.references.includes(file.id)) return
    if (!options.maxReferences || current.references.length >= options.maxReferences)
      throw new ApiError('IMAGE_REFERENCE_INVALID')
    if (!options.config.data || file.size > options.config.data.max_upload_bytes)
      throw new ApiError('FILE_TOO_LARGE')
    runtime.queryClient.setQueryData(
      ['user', runtime.session.getSnapshot().user?.id, 'file', file.id],
      file,
    )
    patch({ references: [...current.references, file.id] })
  }
  const upload = useReferenceUploads({
    ids: draft.references,
    limit: options.maxReferences,
    maxBytes,
    enabled: !locked && options.maxReferences > 0 && !!maxBytes,
    commit: attach,
  })
  const full = upload.used >= options.maxReferences
  const attachable = !locked && options.maxReferences > 0 && !full && !!maxBytes
  const dragging = useFileDrop({
    enabled: attachable,
    title: locked
      ? t('react.dropLocked')
      : !options.maxReferences
        ? t('images.editUnsupported')
        : full
          ? t('react.dropFull', { max: options.maxReferences })
          : t('react.dropTitle'),
    hint:
      attachable && size
        ? t('react.dropHint', { size, count: options.maxReferences - upload.used })
        : '',
    onFiles: (files) => upload.uploads.add(files),
  })
  const invalidReferences = draft.references.length > options.maxReferences
  const insufficient =
    !!options.quote &&
    !!options.account.data &&
    options.quote.total_cost > options.account.data.total
  const disabled =
    locked ||
    upload.busy ||
    options.pricing ||
    !draft.prompt.trim() ||
    !options.models.selected ||
    !options.quote ||
    !options.account.data ||
    insufficient ||
    invalidReferences
  async function submit(retry = false) {
    if (retry ? sending : disabled) return
    const quality = options.quality
    const selected = options.models.selected
    let body: Omit<ImageInput, 'conversation_id'> | undefined
    if (!retry) {
      if (!quality || !selected) return
      body = {
        model_id: selected.id,
        prompt: draft.prompt,
        quality,
        size: options.size,
        ratio: options.ratio,
        n: options.n,
        reference_file_ids: draft.references,
      }
    }
    const result = await controller.submit(conversationId, body)
    if (result && result !== conversationId) await navigate('/create/' + result, { replace: true })
  }
  const summary = options.quality
    ? [
        t('images.' + options.quality),
        options.ratio || options.size,
        t('react.imageCount', { count: options.n }),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('images.noPrice')
  const cost = (
    <>
      <span>
        {options.quote
          ? t('images.estimate', { cost: options.quote.total_cost })
          : t(options.pricing ? 'common.loading' : 'images.noPrice')}
      </span>
      <span>
        {options.account.data
          ? t('images.balance', { balance: options.account.data.total })
          : t('common.loading')}
      </span>
    </>
  )
  const retryButton = pending ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={panel ? 'w-full' : 'mb-2'}
      disabled={sending}
      onClick={() => {
        void submit(true)
      }}
    >
      <RotateCw size={13} />
      {t('images.retry')}
    </Button>
  ) : null
  const fileInput = (
    <input
      ref={picker}
      type="file"
      className="hidden"
      accept={referenceAccept}
      multiple
      disabled={!attachable}
      aria-label={t('images.upload')}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        upload.uploads.add(files)
      }}
    />
  )
  const textareaProps = {
    id,
    ref: textarea,
    value: draft.prompt,
    placeholder: t('images.placeholder'),
    maxLength: 64000,
    disabled: locked,
    onChange: (event: { target: { value: string } }) => patch({ prompt: event.target.value }),
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onKeyDown: (event: {
      key: string
      shiftKey: boolean
      nativeEvent: { isComposing: boolean; keyCode: number }
      preventDefault(): void
    }) => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing &&
        !composing.current &&
        event.nativeEvent.keyCode !== 229
      ) {
        event.preventDefault()
        void submit()
      }
    },
  }
  const tray = (children?: ReactNode) => (
    <ReferenceTray
      ids={draft.references}
      items={upload.items}
      previews={upload.previews}
      disabled={locked}
      compact
      previewable
      className="image-references"
      onRemove={(value) =>
        patch({ references: draft.references.filter((reference) => reference !== value) })
      }
      onRetry={(key) => upload.uploads.retry(key)}
      onCancel={(key) => upload.uploads.cancel(key)}
    >
      {children}
    </ReferenceTray>
  )
  const referenceProblem = invalidReferences ? (
    <p role="status" className="text-xs text-destructive">
      {t(options.maxReferences ? 'images.referenceLimit' : 'images.editUnsupported', {
        count: options.maxReferences,
      })}
    </p>
  ) : null
  const libraryDialog =
    library && options.config.data ? (
      <Suspense fallback={null}>
        <ImageLibrary
          maxUploadBytes={options.config.data.max_upload_bytes}
          onClose={() => setLibrary(false)}
          onChoose={(file) => {
            try {
              setLocalError(null)
              attach(file)
            } catch (failure) {
              setLocalError(failure)
            }
          }}
        />
      </Suspense>
    ) : null
  const parameters = <ImageParameters options={options} disabled={locked} onPatch={patch} />
  const notice = error || localError || options.error

  if (panel)
    return (
      <form
        className="image-composer flex h-full min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onPaste={(event) => {
          if (event.clipboardData.files.length) {
            event.preventDefault()
            upload.uploads.add(Array.from(event.clipboardData.files))
          }
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-5">
          {notice ? (
            <div className="mb-3">
              <ApiNotice error={notice} />
            </div>
          ) : null}
          <div className="mb-3 -ml-1">
            <ModelPicker kind="image" disabled={locked} />
          </div>
          <div
            className={cn(
              'rounded-2xl border border-input bg-card shadow-xs transition-[border-color,box-shadow] duration-200 focus-within:border-ring/45 focus-within:shadow-sm',
              dragging && attachable && 'border-primary/60 ring-4 ring-primary/10',
            )}
          >
            <label
              htmlFor={id}
              className="block px-3.5 pt-3 text-xs font-medium text-muted-foreground"
            >
              {t('images.prompt')}
            </label>
            <textarea
              {...textareaProps}
              rows={4}
              className="block min-h-28 w-full resize-none bg-transparent px-3.5 pt-1.5 pb-3 text-base leading-7 outline-none placeholder:text-muted-foreground sm:text-sm"
            />
            <div className="flex flex-col gap-2 border-t border-border p-3">
              {upload.used ? (
                tray(
                  attachable ? (
                    <button
                      type="button"
                      className="grid size-16 shrink-0 place-items-center rounded-xl border border-dashed border-input text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={t('images.upload')}
                      title={t('react.dropzoneHint')}
                      onClick={() => picker.current?.click()}
                    >
                      <Plus size={18} />
                    </button>
                  ) : null,
                )
              ) : (
                <button
                  type="button"
                  disabled={!attachable}
                  aria-label={t('images.upload')}
                  onClick={() => picker.current?.click()}
                  className="group flex min-h-14 w-full items-center gap-3 rounded-xl border border-dashed border-input px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input disabled:hover:bg-transparent"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-primary">
                    <ImagePlus size={16} />
                  </span>
                  <span className="min-w-0 text-xs leading-5">
                    <span className="block font-medium text-foreground">
                      {options.maxReferences
                        ? t('react.dropzoneHint')
                        : t('images.editUnsupported')}
                    </span>
                    {options.maxReferences && size ? (
                      <span className="block text-muted-foreground">
                        {t('react.dropHint', { size, count: options.maxReferences })}
                      </span>
                    ) : null}
                  </span>
                </button>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-1.5 px-2"
                  disabled={locked || !options.maxReferences}
                  onClick={() => setLibrary(true)}
                >
                  <Images size={14} />
                  {t('images.library')}
                </Button>
                {options.maxReferences && upload.used ? (
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    <span aria-hidden="true">
                      {t('react.referenceSlots', {
                        count: upload.used,
                        max: options.maxReferences,
                      })}
                    </span>
                    <span className="sr-only">
                      {t('react.referenceSlotsLabel', {
                        count: upload.used,
                        max: options.maxReferences,
                      })}
                    </span>
                  </span>
                ) : null}
              </div>
              {referenceProblem}
              <UploadNotice notice={upload.notice} size={size} />
            </div>
            {fileInput}
          </div>
          <section aria-label={t('react.imageParameters')} className="mt-5">
            <h2 aria-hidden="true" className="mb-3 text-xs font-semibold tracking-tight">
              {t('react.imageParameters')}
            </h2>
            {parameters}
          </section>
        </div>
        <div className="flex shrink-0 flex-col gap-2.5 border-t border-border px-4 pt-3 pb-4">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            {cost}
          </div>
          {insufficient ? (
            <Link className="text-xs text-primary hover:underline" to="/me/credits">
              {t('images.insufficient')}
            </Link>
          ) : null}
          {retryButton}
          <Button type="submit" size="lg" className="w-full" disabled={disabled}>
            {t('images.send')}
          </Button>
          <p className="text-center text-2xs text-muted-foreground">{t('react.promptHint')}</p>
        </div>
        {libraryDialog}
      </form>
    )

  return (
    <section className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-1 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
      <ApiNotice error={notice} />
      {retryButton}
      <form
        className={cn(
          'image-composer relative mt-2 rounded-3xl border border-input bg-card shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-ring/45 focus-within:shadow-md',
          dragging && attachable && 'border-primary/60 ring-4 ring-primary/10',
        )}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onPaste={(event) => {
          if (event.clipboardData.files.length) {
            event.preventDefault()
            upload.uploads.add(Array.from(event.clipboardData.files))
          }
        }}
      >
        {upload.used ? <div className="px-3 pt-3">{tray()}</div> : null}
        {invalidReferences ? <div className="px-4 pt-2">{referenceProblem}</div> : null}
        <label htmlFor={id} className="sr-only">
          {t('images.prompt')}
        </label>
        <textarea
          {...textareaProps}
          rows={1}
          className="block min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-7 outline-none placeholder:text-muted-foreground sm:text-[15px]"
        />
        <div className="flex min-w-0 items-center gap-0.5 px-2 pt-1 pb-2">
          <div className="min-w-0 flex-1">
            <ModelPicker kind="image" disabled={locked} />
          </div>
          {fileInput}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            aria-label={t('images.upload')}
            title={t('react.dropzoneHint')}
            disabled={!attachable}
            onClick={() => picker.current?.click()}
          >
            <ImagePlus size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            aria-label={t('images.library')}
            disabled={locked || !options.maxReferences}
            onClick={() => setLibrary(true)}
          >
            <Images size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            aria-label={t('react.imageParameters')}
            onClick={() => setSheet(true)}
          >
            <SlidersHorizontal size={17} />
          </Button>
          <Button
            type="submit"
            size="icon"
            className="size-9 rounded-full"
            aria-label={t('images.send')}
            disabled={disabled}
          >
            <ArrowUp size={18} strokeWidth={2.2} />
          </Button>
        </div>
      </form>
      <UploadNotice notice={upload.notice} size={size} className="mt-2 px-2" />
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 px-2 text-2xs text-muted-foreground tabular-nums">
        <span>{summary}</span>
        <span className="flex gap-2">{cost}</span>
        {insufficient ? (
          <Link className="text-primary hover:underline" to="/me/credits">
            {t('images.insufficient')}
          </Link>
        ) : null}
      </div>
      <ModalDialog
        open={sheet}
        onOpenChange={setSheet}
        variant="sheet"
        title={t('react.imageParameters')}
        description={summary}
      >
        {parameters}
      </ModalDialog>
      {libraryDialog}
    </section>
  )
}
