import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles, X } from 'lucide-react'
import type { CanvasGeneratorContent, CanvasNode } from '../../../api/canvases'
import type { ImageInput } from '../../../api/images'
import { updateNode } from '../../../features/canvas/commands'
import { LIMITS } from '../../../features/canvas/document'
import { buildPrompt, collectInputs } from '../../../features/canvas/workflow'
import { useCanvas, useCanvasImage, useEditor } from '../../features/canvas/context'
import { useImageOptions } from '../../features/images/options'
import type { ImageDraft } from '../../features/images/controller'
import { ImageParameters } from '../images/ImageParameters'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'

const selectClass =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm shadow-xs outline-none focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-50'

/**
 * Parameters for one generator node. Inputs come from its incoming edges; quotes and
 * limits come from the same backend options the image studio uses.
 */
export function GeneratorInspector({ node, onClose }: { node: CanvasNode; onClose(): void }) {
  const { t } = useTranslation()
  const { editor, generation } = useCanvas()
  const promptField = useId(),
    modelField = useId()
  const doc = useEditor((state) => state.doc)
  const files = useEditor((state) => state.files)
  const [submitting, setSubmitting] = useState(false)
  const generator: CanvasGeneratorContent = node.generator ?? {
    prompt: '',
    model_id: null,
    quality: '',
    size: '',
    ratio: '',
    n: 1,
  }
  const inputs = useMemo(
    () => collectInputs(doc, node.id, (file) => !!files[file]),
    [doc, node.id, files],
  )
  const draft: ImageDraft = {
    prompt: generator.prompt,
    quality: generator.quality,
    size: generator.size,
    ratio: generator.ratio,
    n: generator.n,
    references: inputs.references,
  }
  const options = useImageOptions(draft, generator.model_id ?? undefined)
  const model = options.model
  const prompt = buildPrompt(generator.prompt, inputs.texts)
  const patch = (change: Partial<CanvasGeneratorContent>, key = '') =>
    editor.apply(
      (current) =>
        updateNode(current, node.id, (item) => ({
          ...item,
          generator: { ...generator, ...change },
        })),
      { key },
    )
  const references = inputs.references.length
  const problem = !model
    ? 'canvas.generator.noModel'
    : inputs.unavailable
      ? 'canvas.generator.missingInput'
      : references && !model.capabilities.supports_edit
        ? 'canvas.generator.noEdit'
        : references > options.maxReferences
          ? 'canvas.generator.tooManyReferences'
          : !prompt
            ? 'canvas.generator.emptyPrompt'
            : new TextEncoder().encode(prompt).length > 64000
              ? 'canvas.generator.longPrompt'
              : ''
  const insufficient =
    !!options.quote &&
    !!options.account.data &&
    options.account.data.total < options.quote.total_cost
  const disabled =
    submitting || !!problem || !options.quote || !options.quality || !options.size || insufficient

  async function run() {
    if (disabled || !model || !options.quality) return
    setSubmitting(true)
    try {
      await generation.submit({
        node_id: node.id,
        model_id: model.id,
        quality: options.quality as ImageInput['quality'],
        size: options.size,
        ratio: options.ratio,
        n: options.n,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      aria-label={t('canvas.generator.heading')}
      data-testid="canvas-inspector"
      className="flex min-h-0 flex-col gap-4"
    >
      <header className="flex items-center gap-2">
        <Sparkles size={16} className="text-primary" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-semibold">{t('canvas.generator.heading')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('canvas.generator.close')}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={promptField} className="text-xs font-medium text-muted-foreground">
          {t('canvas.generator.prompt')}
        </label>
        <textarea
          id={promptField}
          autoFocus
          value={generator.prompt}
          maxLength={LIMITS.prompt}
          placeholder={t('canvas.generator.promptPlaceholder')}
          onChange={(event) => patch({ prompt: event.target.value }, 'prompt:' + node.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void run()
            }
          }}
          className="min-h-28 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm leading-6 shadow-xs outline-none focus:border-ring focus:ring-3 focus:ring-ring/15"
        />
        <p className="text-xs leading-5 text-muted-foreground" data-testid="canvas-inputs">
          {references || inputs.texts.length
            ? t('canvas.generator.inputs', { images: references, texts: inputs.texts.length })
            : t('canvas.generator.noInputs')}
        </p>
        {inputs.unavailable ? (
          <p className="text-xs leading-5 text-warning">
            {t('canvas.generator.unavailable', { count: inputs.unavailable })}
          </p>
        ) : null}
        {inputs.references.length ? (
          <div className="flex flex-wrap gap-1.5">
            {inputs.references.map((id, index) => (
              <ReferenceThumbnail key={id} id={id} index={index} />
            ))}
          </div>
        ) : null}
        {inputs.texts.length ? (
          <ul className="grid max-h-20 gap-1 overflow-y-auto text-xs text-muted-foreground">
            {inputs.texts.map((text, index) => (
              <li key={index} className="truncate" title={text}>
                {text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modelField} className="text-xs font-medium text-muted-foreground">
          {t('canvas.generator.model')}
        </label>
        <select
          id={modelField}
          className={selectClass}
          value={model?.id ?? ''}
          disabled={submitting || !options.models.items.length}
          onChange={(event) =>
            patch({ model_id: event.target.value, quality: '', size: '', ratio: '' })
          }
        >
          {options.models.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.display_name}
            </option>
          ))}
        </select>
      </div>
      <ImageParameters
        options={options}
        disabled={submitting}
        onPatch={(value) => {
          const change: Partial<CanvasGeneratorContent> = {}
          if (value.quality !== undefined) change.quality = value.quality
          if (value.size !== undefined) change.size = value.size
          if (value.ratio !== undefined) change.ratio = value.ratio
          if (value.n !== undefined) change.n = Math.max(1, Math.min(LIMITS.count, value.n))
          patch(change)
        }}
      />
      {problem ? (
        <p role="status" className="text-xs leading-5 text-warning">
          {t(problem, { max: options.maxReferences })}
        </p>
      ) : null}
      {options.error ? <ApiNotice error={options.error} /> : null}
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
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
        </div>
        <Button type="button" disabled={disabled} onClick={() => void run()}>
          {submitting ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          {submitting ? t('canvas.generator.running') : t('canvas.generator.run')}
        </Button>
      </div>
    </section>
  )
}

function ReferenceThumbnail({ id, index }: { id: string; index: number }) {
  const { t } = useTranslation()
  const file = useEditor((state) => state.files[id])
  const image = useCanvasImage(file, 'thumb')
  return image?.url ? (
    <img
      src={image.url}
      alt={t('canvas.generator.reference', { number: index + 1 })}
      className="size-9 rounded border border-border object-cover"
    />
  ) : null
}
