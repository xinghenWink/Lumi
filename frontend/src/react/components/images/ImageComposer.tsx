import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ArrowUp, ImagePlus, Images, SlidersHorizontal } from 'lucide-react'
import { useStore } from 'zustand'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { images, type ImageFile, type ImageInput } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { emptyImageDraft, imageSubmissionScope } from '../../features/images/controller'
import { useImageOptions } from '../../features/images/options'
import { ApiNotice } from '../shared/ApiNotice'
import { ModelPicker } from '../catalog/ModelPicker'
import { Button } from '../ui/button'
import { ReferenceChips } from './ReferenceChips'
const ImageLibrary = lazy(() =>
  import('./ImageLibrary').then((module) => ({ default: module.ImageLibrary })),
)

export function ImageComposer({ conversationId }: { conversationId: string }) {
  const runtime = useRuntime(),
    { t } = useTranslation(),
    navigate = useNavigate()
  const scope = useStore(runtime.image.store, (state) =>
    imageSubmissionScope(state, conversationId),
  )
  const draft = useStore(runtime.image.store, (state) => state.drafts[scope] ?? emptyImageDraft)
  const pending = useStore(runtime.image.store, (state) => state.pending[scope])
  const sending = useStore(runtime.image.store, (state) => !!state.sending[scope])
  const error = useStore(runtime.image.store, (state) => state.errors[scope])
  const options = useImageOptions(draft)
  const [uploading, setUploading] = useState(false),
    [library, setLibrary] = useState(false)
  const [localError, setLocalError] = useState<unknown>(null)
  const picker = useRef<HTMLInputElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null)
  const uploadController = useRef<AbortController | null>(null),
    composing = useRef(false)
  const id = useId(),
    parameters = useId()
  const locked = sending || !!pending
  const invalidReferences = draft.references.length > options.maxReferences
  const disabled =
    locked ||
    uploading ||
    options.pricing ||
    !draft.prompt.trim() ||
    !options.models.selected ||
    !options.quote ||
    !options.account.data ||
    options.quote.total_cost > options.account.data.total ||
    invalidReferences
  useEffect(
    () => () => {
      uploadController.current?.abort()
    },
    [],
  )
  useEffect(() => {
    if (draft.references.length) textarea.current?.focus()
  }, [draft.references.length])
  function patch(value: Parameters<typeof runtime.image.draft>[1]) {
    runtime.image.draft(conversationId, value)
  }
  function add(file: ImageFile) {
    const current = runtime.image.store.getState().drafts[scope] ?? emptyImageDraft
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
  async function upload(files: File[]) {
    if (locked || uploading) return
    const controller = new AbortController(),
      owner = runtime.session.getSnapshot().user?.id,
      epoch = runtime.session.snapshot().epoch
    const live = () =>
      !controller.signal.aborted &&
      owner === runtime.session.getSnapshot().user?.id &&
      epoch === runtime.session.snapshot().epoch
    uploadController.current?.abort()
    uploadController.current = controller
    setUploading(true)
    setLocalError(null)
    try {
      for (const file of files) {
        const references = runtime.image.store.getState().drafts[scope]?.references ?? []
        if (!options.maxReferences || references.length >= options.maxReferences)
          throw new ApiError('IMAGE_REFERENCE_INVALID')
        if (!options.config.data || file.size > options.config.data.max_upload_bytes)
          throw new ApiError('FILE_TOO_LARGE')
        const result = await images.upload(file, controller.signal)
        if (!live()) return
        add(result)
      }
    } catch (failure) {
      if (live()) setLocalError(failure)
    } finally {
      if (live()) setUploading(false)
    }
  }
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
    const result = await runtime.image.submit(conversationId, body)
    if (result) await navigate('/create/' + result, { replace: true })
  }
  const fieldClass =
    'w-full min-w-0 rounded-lg border border-border bg-background p-2.5 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm'
  return (
    <section className="mx-auto w-full max-w-4xl shrink-0 px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-8 sm:pb-5">
      <ApiNotice error={error || localError || options.error} />
      {pending ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-2"
          disabled={sending}
          onClick={() => {
            void submit(true)
          }}
        >
          {t('images.retry')}
        </Button>
      ) : null}
      <form
        className="image-composer rounded-2xl border border-border bg-card p-3 shadow-sm focus-within:border-primary/40 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void upload(Array.from(event.dataTransfer.files))
        }}
        onPaste={(event) => {
          if (event.clipboardData.files.length) {
            event.preventDefault()
            void upload(Array.from(event.clipboardData.files))
          }
        }}
      >
        {draft.references.length ? (
          <ReferenceChips
            ids={draft.references}
            disabled={locked || uploading}
            onRemove={(id) =>
              patch({ references: draft.references.filter((value) => value !== id) })
            }
          />
        ) : null}
        <label htmlFor={id} className="sr-only">
          {t('images.prompt')}
        </label>
        <textarea
          id={id}
          ref={textarea}
          value={draft.prompt}
          onChange={(event) => patch({ prompt: event.target.value })}
          placeholder={t('images.placeholder')}
          rows={3}
          maxLength={64000}
          disabled={locked}
          className="min-h-20 w-full resize-none bg-transparent px-1 text-base leading-7 outline-none placeholder:text-muted-foreground sm:text-sm"
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(event) => {
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
          }}
        />
        {invalidReferences ? (
          <p role="status" className="text-xs text-destructive">
            {t(options.maxReferences ? 'images.referenceLimit' : 'images.editUnsupported', {
              count: options.maxReferences,
            })}
          </p>
        ) : null}
        <div className="mt-2 flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <ModelPicker kind="image" disabled={locked} />
          </div>
          <input
            ref={picker}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={locked || uploading || !options.maxReferences}
            aria-label={t('images.upload')}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void upload(files)
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('images.upload')}
            disabled={locked || uploading || !options.maxReferences}
            onClick={() => picker.current?.click()}
          >
            <ImagePlus size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('images.library')}
            disabled={locked || !options.maxReferences}
            onClick={() => setLibrary(true)}
          >
            <Images size={17} />
          </Button>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('react.imageParameters')}
              >
                <SlidersHorizontal size={17} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="top"
                align="end"
                sideOffset={12}
                collisionPadding={12}
                aria-label={t('react.imageParameters')}
                className="z-70 w-80 max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-card p-4 text-foreground shadow-xl outline-none"
              >
                <h2 className="mb-4 text-sm font-semibold">{t('react.imageParameters')}</h2>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    htmlFor={parameters + '-quality'}
                    className="flex flex-col gap-2 text-xs text-muted-foreground"
                  >
                    {t('images.quality')}
                    <select
                      id={parameters + '-quality'}
                      aria-label={t('images.quality')}
                      className={fieldClass}
                      value={options.quality}
                      disabled={locked || options.pricing}
                      onChange={(event) => {
                        const quality = options.priced.find((value) => value === event.target.value)
                        if (quality) patch({ quality })
                      }}
                    >
                      {options.priced.map((quality) => (
                        <option key={quality} value={quality}>
                          {t('images.' + quality)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    htmlFor={parameters + '-ratio'}
                    className="flex flex-col gap-2 text-xs text-muted-foreground"
                  >
                    {t('images.ratio')}
                    <select
                      id={parameters + '-ratio'}
                      aria-label={t('images.ratio')}
                      className={fieldClass}
                      value={options.ratio}
                      disabled={locked}
                      onChange={(event) => {
                        const ratio = event.target.value
                        patch({
                          ratio,
                          size:
                            options.ratios.find(([value]) => value === ratio)?.[1] ?? options.size,
                        })
                      }}
                    >
                      <option value="">{t('images.custom')}</option>
                      {options.ratios.map(([ratio]) => (
                        <option key={ratio} value={ratio}>
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    htmlFor={parameters + '-size'}
                    className="flex flex-col gap-2 text-xs text-muted-foreground"
                  >
                    {t('images.size')}
                    <select
                      id={parameters + '-size'}
                      aria-label={t('images.size')}
                      className={fieldClass}
                      value={options.size}
                      disabled={locked}
                      onChange={(event) => patch({ size: event.target.value, ratio: '' })}
                    >
                      {options.sizes.map((size) => (
                        <option key={size} value={size}>
                          {size === 'auto' ? t('images.auto') : size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    htmlFor={parameters + '-count'}
                    className="flex flex-col gap-2 text-xs text-muted-foreground"
                  >
                    {t('images.count')}
                    <select
                      id={parameters + '-count'}
                      aria-label={t('images.count')}
                      className={fieldClass}
                      value={options.n}
                      disabled={locked}
                      onChange={(event) => patch({ n: Number(event.target.value) })}
                    >
                      {Array.from({ length: options.maxN }, (_, index) => index + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button
            type="submit"
            size="icon"
            className="size-9 rounded-full"
            aria-label={t('images.send')}
            disabled={disabled}
          >
            <ArrowUp size={18} />
          </Button>
        </div>
        <p className="mt-2 px-1 text-[10px] text-muted-foreground">
          {options.quality
            ? [
                t('images.' + options.quality),
                options.ratio || options.size,
                t('react.imageCount', { count: options.n }),
              ]
                .filter(Boolean)
                .join(' · ')
            : t('images.noPrice')}
        </p>
      </form>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 px-1 text-[10px] leading-5 text-muted-foreground">
        <span>
          {options.quote
            ? t('images.estimate', { cost: options.quote.total_cost })
            : t(options.pricing ? 'common.loading' : 'images.noPrice')}{' '}
          ·{' '}
          {options.account.data
            ? t('images.balance', { balance: options.account.data.total })
            : t('common.loading')}
        </span>
        {options.quote &&
        options.account.data &&
        options.quote.total_cost > options.account.data.total ? (
          <Link className="text-primary" to="/me/credits">
            {t('images.insufficient')}
          </Link>
        ) : null}
        <span className="hidden sm:inline">{t('images.leaveHint')}</span>
      </div>
      {library && options.config.data ? (
        <Suspense fallback={null}>
          <ImageLibrary
            maxUploadBytes={options.config.data.max_upload_bytes}
            onClose={() => setLibrary(false)}
            onChoose={(file) => {
              try {
                add(file)
              } catch (failure) {
                setLocalError(failure)
              }
            }}
          />
        </Suspense>
      ) : null}
    </section>
  )
}
