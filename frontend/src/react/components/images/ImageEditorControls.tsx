import {
  Brush,
  Eraser,
  ImageMinus,
  MessageSquarePlus,
  Redo2,
  Scan,
  Send,
  Square,
  Circle,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useStore } from 'zustand'
import { images, type ImageEditOptions, type ImageFile, type ImageInput } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { useRuntime } from '../../app/context'
import { useModels } from '../../features/catalog/models'
import { useImageConfig } from '../../features/images/config'
import {
  emptyImageDraft,
  imageSubmissionScope,
  type ImageController,
} from '../../features/images/controller'
import {
  editorRatios,
  renderEditorGuide,
  validEditorRatio,
  type ImageEditorTarget,
} from '../../features/images/editor'
import type { ImageEditorDraft } from '../../features/images/editor-state'
import { resolveImageOptions, useImageOptions } from '../../features/images/options'
import { cn } from '../../lib/utils'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Field } from '../ui/field'
import { Input } from '../ui/input'
import { NativeSelect, NativeSelectOption } from '../ui/native-select'
import { Textarea } from '../ui/textarea'

type EditorProps = {
  file: ImageFile
  target: ImageEditorTarget
  draft: ImageEditorDraft
  onDone(): void
}

const colors = [
  { value: '#ef4444', label: 'red' },
  { value: '#facc15', label: 'yellow' },
  { value: '#22c55e', label: 'green' },
  { value: '#2563eb', label: 'blue' },
  { value: '#ffffff', label: 'white' },
]

export function ImageEditorControls(props: EditorProps) {
  const runtime = useRuntime()
  const { t } = useTranslation()
  const [controller, setController] = useState(runtime.imageController)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (controller) return
    let active = true
    void runtime.loadImage().then(
      (value) => {
        if (active) setController(value)
      },
      () => {
        if (active) setError(new ApiError('IMAGE_EDITOR_UNAVAILABLE'))
      },
    )
    return () => {
      active = false
    }
  }, [controller, runtime])

  return controller ? (
    <EditorForm {...props} controller={controller} />
  ) : error ? (
    <div className="bg-card p-2">
      <ApiNotice error={error} />
    </div>
  ) : (
    <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

function EditorForm({
  file,
  target,
  draft,
  onDone,
  controller,
}: EditorProps & { controller: ImageController }) {
  const { t } = useTranslation()
  const runtime = useRuntime()
  const navigate = useNavigate()
  const { conversationId } = target
  const pending = useStore(
    controller.store,
    (state) => state.pending[imageSubmissionScope(state, conversationId)],
  )
  const sending = useStore(
    controller.store,
    (state) => !!state.sending[imageSubmissionScope(state, conversationId)],
  )
  const submitError = useStore(
    controller.store,
    (state) => state.errors[imageSubmissionScope(state, conversationId)],
  )
  const [error, setError] = useState<unknown>(null)
  const [modelID, setModelID] = useState('')
  const [quality, setQuality] = useState<ImageInput['quality'] | ''>(target.quality ?? '')
  const work = useRef<AbortController>(null)
  useEffect(() => () => work.current?.abort(), [])

  const models = useModels('image')
  const config = useImageConfig()
  const editable = models.items.filter((model) => model.capabilities.supports_edit)
  const model =
    editable.find((item) => item.id === modelID) ??
    editable.find((item) => item.id === target.modelId) ??
    editable.find((item) => item.id === models.selected?.id) ??
    editable[0]
  const sizes = resolveImageOptions(emptyImageDraft, config.data, model)
  const ratioSizes = new Map(
    editorRatios.map((ratio) => [
      ratio,
      (sizes.ratioOptions.get(ratio) ?? []).filter((size) => {
        const [width, height] = size.split('x').map(Number)
        return !!width && !!height && validEditorRatio(width, height, ratio)
      }),
    ]),
  )
  const ratios = editorRatios.filter((ratio) => ratioSizes.get(ratio)?.length)
  const variants = draft.ratio ? ratioSizes.get(draft.ratio) : undefined
  const sourceResolution = sizes.variants.find((preset) => preset.size === target.size)?.resolution
  const resizeSize =
    variants?.find((size) =>
      sizes.variants.some(
        (preset) =>
          preset.ratio === draft.ratio &&
          preset.size === size &&
          preset.resolution === sourceResolution,
      ),
    ) ?? variants?.[0]
  const sourceSize =
    sizes.sizes.find((size) => size === target.size) ??
    sizes.sizes.find((size) => size === file.width + 'x' + file.height) ??
    sizes.sizes.find((size) => {
      const [width, height] = size.split('x').map(Number)
      return !!width && !!height && Math.abs(width / height - file.width / file.height) < 0.001
    })
  const options = useImageOptions(
    {
      ...emptyImageDraft,
      references: [file.id],
      n: 1,
      quality,
      size: (draft.mode === 'resize' ? resizeSize : sourceSize) ?? '',
      ratio: (draft.mode === 'resize' ? draft.ratio : target.ratio) ?? '',
    },
    model?.id,
  )

  const comments = draft.marks.filter((mark) => mark.kind === 'comment')
  const noteId = draft.note?.kind === 'comment' ? draft.note.id : undefined
  const noteText = comments.find((mark) => mark.id === noteId)?.text
  const canRetry = pending?.source === 'editor' && pending.input.reference_file_ids[0] === file.id
  const locked = draft.busy || sending || !!pending
  const transparent = !!model?.capabilities.supports_transparent_background
  const insufficient =
    !!options.quote &&
    !!options.account.data &&
    options.quote.total_cost > options.account.data.total
  const tooLarge = file.size > 10 * 1024 * 1024
  const ready =
    draft.mode === 'erase'
      ? draft.marks.length > 0
      : draft.mode === 'remove_background'
        ? transparent
        : draft.mode === 'resize'
          ? !!resizeSize
          : !!draft.prompt.trim() || comments.length > 0
  const canSubmit =
    !!model &&
    !!options.quality &&
    !!options.quote &&
    !!options.account.data &&
    !!options.maxReferences &&
    !tooLarge &&
    !insufficient &&
    !options.pricing &&
    ready &&
    !draft.note

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (work.current || sending || (canRetry ? false : locked || !canSubmit)) return
    const owner = runtime.session.getSnapshot().user?.id
    const epoch = runtime.session.snapshot().epoch
    const job = new AbortController()
    const valid = () =>
      !job.signal.aborted &&
      owner === runtime.session.getSnapshot().user?.id &&
      epoch === runtime.session.snapshot().epoch
    work.current = job
    draft.setBusy(true)
    setError(null)
    try {
      let input: Omit<ImageInput, 'conversation_id'> | undefined
      if (!canRetry) {
        if (!model || !options.quality) return
        const instruction = draft.prompt.trim()
        const mode = draft.mode === 'markup' && !draft.marks.length ? undefined : draft.mode
        const description =
          mode === 'erase' || mode === 'remove_background' || mode === 'resize'
            ? t('images.editor.instruction.' + mode, { ratio: draft.ratio })
            : ''
        const prompt = [
          description,
          instruction,
          ...(mode === 'markup'
            ? comments.map((mark) =>
                t('images.editor.commentInstruction', { number: mark.id, text: mark.text }),
              )
            : []),
        ]
          .filter(Boolean)
          .join('\n')
        let edit: ImageEditOptions | undefined
        if (mode) edit = { action: mode }
        if (edit && (edit.action === 'markup' || edit.action === 'erase')) {
          const source = await images.blob(file, false, job.signal)
          const guide = await renderEditorGuide(source, draft.marks)
          if (!valid()) return
          if (guide.size > (config.data?.max_upload_bytes ?? 0))
            throw new ApiError('FILE_TOO_LARGE')
          const saved = await images.upload(guide, job.signal, 'edit_guide')
          edit.guide_file_id = saved.id
        }
        input = {
          model_id: model.id,
          prompt,
          quality: options.quality,
          size: options.size,
          ratio: options.ratio,
          n: 1,
          reference_file_ids: [file.id],
          ...(edit ? { edit_options: edit } : {}),
        }
        if (new TextEncoder().encode(JSON.stringify(input)).length > 64_000)
          throw new ApiError('IMAGE_EDIT_INSTRUCTIONS_TOO_LONG')
      }
      if (!valid()) return
      const result = await controller.submit(conversationId, input, 'editor')
      if (!result || !valid()) return
      onDone()
      if (result !== conversationId) await navigate('/create/' + encodeURIComponent(result))
    } catch (failure) {
      if (valid())
        setError(failure instanceof ApiError ? failure : new ApiError('IMAGE_EDIT_GUIDE_INVALID'))
    } finally {
      if (work.current === job) work.current = null
      if (valid()) {
        const state = controller.store.getState()
        draft.setSubmissionPending(!!state.pending[imageSubmissionScope(state, conversationId)])
        draft.setBusy(false)
      }
    }
  }

  return (
    <div
      className="max-h-[58dvh] shrink-0 overflow-y-auto border-t border-border bg-card px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] text-card-foreground sm:px-4"
      data-slot="image-editor"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div
          role="group"
          aria-label={t('images.editor.tools')}
          className="flex w-fit max-w-full items-center gap-1 self-center overflow-x-auto rounded-xl bg-muted p-1"
        >
          <Button
            variant={draft.mode === 'markup' && draft.tool !== 'comment' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={locked}
            aria-pressed={draft.mode === 'markup' && draft.tool !== 'comment'}
            onClick={() => draft.select('markup', 'pen')}
          >
            <Brush size={16} aria-hidden="true" />
            {t('images.editor.markup')}
          </Button>
          <Button
            variant={draft.tool === 'comment' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={locked}
            aria-pressed={draft.tool === 'comment'}
            onClick={() => draft.select('markup', 'comment')}
          >
            <MessageSquarePlus size={16} aria-hidden="true" />
            {t('images.editor.comment')}
          </Button>
          <Button
            variant={draft.mode === 'remove_background' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={locked || !transparent}
            aria-pressed={draft.mode === 'remove_background'}
            onClick={() => draft.select('remove_background')}
          >
            <ImageMinus size={16} aria-hidden="true" />
            {t('images.editor.remove_background')}
          </Button>
          <Button
            variant={draft.mode === 'erase' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={locked}
            aria-pressed={draft.mode === 'erase'}
            onClick={() => draft.select('erase', 'erase')}
          >
            <Eraser size={16} aria-hidden="true" />
            {t('images.editor.erase')}
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant={draft.mode === 'resize' ? 'secondary' : 'ghost'}
                size="sm"
                disabled={locked || !ratios.length}
              >
                <Scan size={16} aria-hidden="true" />
                {t('images.editor.resize')}
                {draft.mode === 'resize' && draft.ratio ? ' ' + draft.ratio : ''}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ratios.map((ratio) => (
                <DropdownMenuItem
                  key={ratio}
                  onSelect={() => {
                    draft.select('resize')
                    draft.setRatio(ratio)
                  }}
                >
                  {t('images.editor.ratios.' + ratio.replace(':', 'x'))}{' '}
                  <span className="ml-auto pl-3 text-muted-foreground">{ratio}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {draft.mode ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={locked}
              aria-label={t('images.editor.exitTool')}
              title={t('images.editor.exitTool')}
              onClick={() => draft.select()}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {draft.mode === 'markup' || draft.mode === 'erase' ? (
          <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
            role="group"
            aria-label={t('images.editor.toolOptions')}
          >
            {draft.mode === 'markup' ? (
              <>
                {(
                  [
                    ['pen', Brush],
                    ['rectangle', Square],
                    ['ellipse', Circle],
                    ['text', Type],
                  ] as const
                ).map(([tool, Icon]) => (
                  <Button
                    key={tool}
                    size="icon-sm"
                    variant={draft.tool === tool ? 'secondary' : 'ghost'}
                    aria-label={t('images.editor.' + tool)}
                    title={t('images.editor.' + tool)}
                    aria-pressed={draft.tool === tool}
                    disabled={locked}
                    onClick={() => draft.select('markup', tool)}
                  >
                    <Icon size={17} aria-hidden="true" />
                  </Button>
                ))}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('images.editor.color')}
                      disabled={locked}
                    >
                      <span
                        className="size-4 rounded-full border border-border"
                        style={{ backgroundColor: draft.color }}
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {colors.map(({ value, label }) => (
                      <DropdownMenuItem key={value} onSelect={() => draft.setColor(value)}>
                        <span
                          className="size-3 rounded-full border border-border"
                          style={{ backgroundColor: value }}
                        />
                        {t('images.editor.colors.' + label)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <label className="flex shrink-0 items-center gap-2 px-1 text-xs">
                {t('images.editor.brushSize')}
                <Input
                  type="range"
                  min={2}
                  max={25}
                  value={draft.brush}
                  disabled={locked}
                  className="h-7 w-24 cursor-pointer px-1 accent-primary"
                  onChange={(event) => draft.setBrush(Number(event.target.value))}
                />
              </label>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('images.editor.undo')}
              title={t('images.editor.undo')}
              disabled={locked || !draft.canUndo}
              onClick={() => draft.step('undo')}
            >
              <Undo2 size={17} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('images.editor.redo')}
              title={t('images.editor.redo')}
              disabled={locked || !draft.canRedo}
              onClick={() => draft.step('redo')}
            >
              <Redo2 size={17} aria-hidden="true" />
            </Button>
            <span className="shrink-0 px-1 text-xs text-muted-foreground">
              {draft.mode === 'erase'
                ? t('images.editor.eraseHint')
                : draft.tool === 'comment'
                  ? t('images.editor.commentHint')
                  : t('images.editor.markupHint')}
            </span>
          </div>
        ) : null}
        {draft.mode === 'markup' && comments.length ? (
          <ul
            className="flex max-h-20 flex-col gap-1 overflow-y-auto text-xs"
            aria-label={t('images.editor.comments')}
          >
            {comments.map((mark) => (
              <li key={mark.id} className="flex items-center gap-1 rounded-md bg-muted px-1">
                <Button
                  className="min-w-0 flex-1 justify-start"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  onClick={() => draft.setNote({ kind: 'comment', id: mark.id, at: mark.at })}
                >
                  <span className="shrink-0 tabular-nums">{mark.id}</span>
                  <span className="truncate">{mark.text}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={locked}
                  aria-label={t('images.editor.deleteComment', { number: mark.id })}
                  onClick={() => draft.deleteComment(mark.id)}
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {draft.note ? (
          <NoteForm
            key={
              draft.note.kind + ':' + (noteId ?? '') + ':' + draft.note.at.x + ':' + draft.note.at.y
            }
            label={t(
              draft.note.kind === 'comment' ? 'images.editor.comment' : 'images.editor.text',
            )}
            initialValue={noteText ?? ''}
            onSave={draft.saveNote}
            onCancel={() => draft.setNote(undefined)}
            disabled={locked}
          />
        ) : null}
        <form
          onSubmit={(event) => {
            void submit(event)
          }}
          className="flex min-w-0 flex-col gap-2"
        >
          <Textarea
            aria-label={t('images.editor.prompt')}
            placeholder={t('images.editor.prompt')}
            value={draft.prompt}
            onChange={(event) => draft.setPrompt(event.target.value)}
            maxLength={4000}
            rows={1}
            disabled={locked}
            className="min-h-9 resize-none"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {model ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:basis-full">
                {editable.length > 1 ? (
                  <div className="w-36 max-w-full">
                    <NativeSelect
                      size="sm"
                      aria-label={t('images.editor.model')}
                      value={model?.id ?? ''}
                      disabled={locked}
                      onChange={(event) => setModelID(event.target.value)}
                    >
                      {editable.map((item) => (
                        <NativeSelectOption key={item.id} value={item.id}>
                          {item.display_name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                ) : model ? (
                  <span className="max-w-36 truncate text-muted-foreground">
                    {model.display_name}
                  </span>
                ) : null}
                {options.priced.length ? (
                  <div className="w-24 max-w-full">
                    <NativeSelect
                      size="sm"
                      aria-label={t('images.quality')}
                      value={options.quality}
                      disabled={locked}
                      onChange={(event) => {
                        const value = options.priced.find((item) => item === event.target.value)
                        if (value) setQuality(value)
                      }}
                    >
                      {options.priced.map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {t('images.' + value)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                ) : null}
              </div>
            ) : null}
            <span
              className={cn('flex-1 text-muted-foreground', insufficient && 'text-destructive')}
              role="status"
            >
              {pending && !canRetry
                ? t('images.editor.pending')
                : insufficient
                  ? t('images.insufficient')
                  : options.quote
                    ? t('images.estimate', { cost: options.quote.total_cost })
                    : model && options.pricing
                      ? t('common.loading')
                      : model
                        ? t('images.noPrice')
                        : t('images.editor.noModel')}
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={canRetry ? draft.busy || sending : locked || !canSubmit}
            >
              <Send size={16} aria-hidden="true" />
              {t(
                draft.busy || sending
                  ? 'images.editor.submitting'
                  : canRetry
                    ? 'common.retry'
                    : 'images.editor.submit',
              )}
            </Button>
          </div>
        </form>
        {model && !transparent && !draft.mode ? (
          <p className="text-xs text-muted-foreground">
            {t('images.editor.backgroundUnavailable')}
          </p>
        ) : null}
        {tooLarge ? <ApiNotice error={new ApiError('FILE_TOO_LARGE')} /> : null}
        <ApiNotice error={error ?? submitError ?? options.error} />
      </div>
    </div>
  )
}

function NoteForm({
  label,
  initialValue,
  onSave,
  onCancel,
  disabled,
}: {
  label: string
  initialValue: string
  onSave(text: string): void
  onCancel(): void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [value, setValue] = useState(initialValue)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && value.trim()) onSave(value)
      }}
    >
      <div className="min-w-0 flex-1">
        <Field label={label} id={id}>
          <Input
            id={id}
            ref={input}
            maxLength={500}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" size="sm" disabled={!value.trim() || disabled}>
        {t('common.save')}
      </Button>
    </form>
  )
}
