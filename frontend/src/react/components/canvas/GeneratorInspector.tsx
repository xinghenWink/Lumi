import { useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Loader2, SlidersHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CanvasGeneratorContent, CanvasNode, CanvasTextSettings } from '../../../api/canvases'
import type { ImageInput } from '../../../api/images'
import { updateNode } from '../../../features/canvas/commands'
import {
  buildPrompt,
  collectInputs,
  missingMentions,
  referenceNodes,
} from '../../../features/canvas/workflow'
import { useCanvas, useEditor } from '../../features/canvas/context'
import { useModels } from '../../features/catalog/models'
import { useImageOptions } from '../../features/images/options'
import { ImageParameters } from '../images/ImageParameters'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { CanvasPrompt } from './CanvasPrompt'

const selectClass =
  'h-9 min-w-0 rounded-full border border-border bg-muted px-3 text-sm focus-visible:outline-ring'
const defaultImage: CanvasGeneratorContent = {
  prompt: '',
  model_id: null,
  quality: '',
  size: '',
  ratio: '',
  n: 1,
}
const defaultText: CanvasTextSettings = { prompt: '', model_id: null, reasoning: '', n: 1 }

interface InspectorProps {
  node: CanvasNode
  onClose(): void
  parametersOpen: boolean
  onParametersOpenChange(open: boolean): void
}

export function GeneratorInspector(props: InspectorProps) {
  return props.node.kind === 'text' ? <TextComposer {...props} /> : <ImageComposer {...props} />
}

function Composer({
  node,
  label,
  model,
  options,
  parameters,
  parameterSummary,
  footer,
  disabled,
  busy,
  onModel,
  onClose,
  onRun,
  parametersOpen,
  onParametersOpenChange,
  children,
}: InspectorProps & {
  label: string
  model: string
  options: Array<{ id: string; name: string }>
  parameters: ReactNode
  parameterSummary?: string
  footer: ReactNode
  disabled: boolean
  busy: boolean
  onModel(id: string): void
  onRun(): void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const parametersButton = useRef<HTMLButtonElement>(null)
  return (
    <section
      aria-label={label}
      data-testid="canvas-inspector"
      data-node-composer={node.kind}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="relative pr-9">
        {children}
        <button
          type="button"
          aria-label={t('canvas.generator.close')}
          onClick={onClose}
          className="absolute top-0 right-0 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X size={17} />
        </button>
      </div>
      {footer}
      <div className="@container flex flex-wrap items-center gap-2">
        <select
          aria-label={t('canvas.generator.model')}
          className={selectClass + ' max-w-[min(45%,13rem)]'}
          value={model}
          disabled={busy || !options.length}
          onChange={(event) => onModel(event.target.value)}
        >
          {!options.length ? <option value="">{t('canvas.generator.noModel')}</option> : null}
          {options.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button
          ref={parametersButton}
          type="button"
          variant="outline"
          aria-haspopup="dialog"
          aria-expanded={parametersOpen}
          onClick={() => onParametersOpenChange(true)}
        >
          <SlidersHorizontal size={15} />
          {t('canvas.prompt.parameters')}
        </Button>
        {parameterSummary ? (
          <p
            data-testid="canvas-image-parameter-summary"
            className="order-last basis-full text-xs text-muted-foreground tabular-nums @min-[480px]:order-none @min-[480px]:basis-auto"
          >
            {parameterSummary}
          </p>
        ) : null}
        <Button
          type="button"
          aria-label={t('canvas.generator.run')}
          title={t('canvas.generator.run')}
          className="ml-auto rounded-full"
          disabled={disabled}
          onClick={onRun}
        >
          {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={17} />}
        </Button>
      </div>
      <ModalDialog
        open={parametersOpen}
        onOpenChange={onParametersOpenChange}
        title={t(
          node.kind === 'text' ? 'canvas.prompt.textParameters' : 'canvas.prompt.imageParameters',
        )}
        description={t('canvas.prompt.parametersDescription')}
        returnFocus={parametersButton}
        className="z-[70]"
        overlayClassName="z-[65]"
      >
        {parameters}
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={() => onParametersOpenChange(false)}>
            {t('canvas.generator.close')}
          </Button>
        </div>
      </ModalDialog>
    </section>
  )
}

function ImageComposer({ node, ...props }: InspectorProps) {
  const { t } = useTranslation()
  const { editor, generation } = useCanvas()
  const doc = useEditor((state) => state.doc)
  const files = useEditor((state) => state.files)
  const [busy, setBusy] = useState(false)
  const settings = node.generator ?? defaultImage
  const available = (id: string) => !!files[id]
  const inputs = collectInputs(doc, node.id, available)
  const missing = missingMentions(
    referenceNodes(doc, node.id, true),
    settings.mentions ?? [],
    available,
  )
  const options = useImageOptions(
    {
      ...settings,
      references: inputs.references,
      complexityModelId: settings.model_id ?? undefined,
    },
    settings.model_id ?? undefined,
  )
  const model = options.model
  const count = t('react.imageCount', { count: options.n })
  const parameterSummary =
    options.size && options.n
      ? options.size === 'auto'
        ? t('canvas.prompt.imageParameterAutoSummary', { ratio: t('images.auto'), count })
        : t('canvas.prompt.imageParameterSummary', {
            ratio: options.ratio || t('images.custom'),
            resolution: options.resolution
              ? t('images.resolutionTier.' + options.resolution)
              : options.size.replace('x', ' × '),
            count,
          })
      : ''
  const prompt = buildPrompt(settings.prompt, inputs.texts)
  function patch(
    change: Partial<Omit<CanvasGeneratorContent, 'complexity'>> & {
      complexity?: CanvasGeneratorContent['complexity']
    },
    key = '',
  ) {
    editor.apply(
      (current) =>
        updateNode(current, node.id, (item) => {
          const { complexity, ...generator } = { ...(item.generator ?? defaultImage), ...change }
          return { ...item, generator: { ...generator, ...(complexity ? { complexity } : {}) } }
        }),
      { key },
    )
  }
  const problem = !model
    ? 'canvas.generator.noModel'
    : missing.length || inputs.unavailable
      ? 'canvas.generator.missingInput'
      : options.noImageSize
        ? 'images.noImageSize'
        : inputs.references.length && !model.capabilities.supports_edit
          ? 'canvas.generator.noEdit'
          : inputs.references.length > options.maxReferences
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
    busy || !!problem || !options.quote || !options.quality || !options.size || insufficient
  async function run() {
    if (disabled || !model) return
    setBusy(true)
    try {
      await generation.submit({
        node_id: node.id,
        model_id: model.id,
        quality: options.quality as ImageInput['quality'],
        ...(options.complexity ? { complexity: options.complexity } : {}),
        size: options.size,
        ratio: options.ratio,
        n: options.n,
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Composer
      {...props}
      node={node}
      label={t('canvas.generator.heading')}
      model={model?.id ?? ''}
      options={options.models.items.map((item) => ({ id: item.id, name: item.display_name }))}
      onModel={(id) =>
        patch({ model_id: id, quality: '', size: '', ratio: '', complexity: undefined })
      }
      parameters={
        <ImageParameters
          options={options}
          disabled={busy}
          onPatch={(change) =>
            patch(change.complexity && model ? { ...change, model_id: model.id } : change)
          }
        />
      }
      parameterSummary={parameterSummary}
      footer={
        <>
          <p data-testid="canvas-inputs" className="sr-only">
            {t('canvas.generator.inputs', {
              images: inputs.references.length,
              texts: inputs.texts.length,
            })}
          </p>
          {problem ? (
            <p role="status" className="text-xs text-warning">
              {t(problem, { max: options.maxReferences })}
            </p>
          ) : null}
          {options.error ? <ApiNotice error={options.error} /> : null}
          {options.quote ? (
            <p className="text-xs text-muted-foreground">
              {t('images.estimate', { cost: options.quote.total_cost })}
            </p>
          ) : null}
        </>
      }
      busy={busy}
      disabled={disabled}
      onRun={() => void run()}
    >
      <CanvasPrompt
        node={node}
        value={settings.prompt}
        mentions={settings.mentions ?? []}
        onChange={(prompt, mentions) => patch({ prompt, mentions }, 'prompt:' + node.id)}
        onSend={() => void run()}
        placeholder={t('canvas.generator.promptPlaceholder')}
      />
    </Composer>
  )
}

function TextComposer({ node, ...props }: InspectorProps) {
  const { t } = useTranslation()
  const { editor, textRuns } = useCanvas()
  const doc = useEditor((state) => state.doc)
  const files = useEditor((state) => state.files)
  const [busy, setBusy] = useState(false)
  const settings = node.text_settings ?? defaultText
  const models = useModels('chat')
  const available = (id: string) => !!files[id]
  const inputs = collectInputs(doc, node.id, available)
  const missing = missingMentions(referenceNodes(doc, node.id), settings.mentions ?? [], available)
  const model =
    (settings.model_id ? models.items.find((item) => item.id === settings.model_id) : undefined) ??
    (inputs.references.length
      ? models.items.find((item) => item.capabilities.vision)
      : undefined) ??
    models.selected
  const reasoning = model?.capabilities.reasoning_effort ? settings.reasoning : ''
  const problem = !model
    ? 'canvas.prompt.noTextModel'
    : missing.length || inputs.unavailable
      ? 'canvas.generator.missingInput'
      : inputs.references.length > 4
        ? 'canvas.prompt.textLimit'
        : inputs.references.length && !model.capabilities.vision
          ? 'canvas.prompt.vision'
          : !buildPrompt(settings.prompt, inputs.texts)
            ? 'canvas.generator.emptyPrompt'
            : ''
  function patch(change: Partial<CanvasTextSettings>, key = '') {
    editor.apply(
      (current) =>
        updateNode(current, node.id, (item) => ({
          ...item,
          text_settings: { ...(item.text_settings ?? defaultText), ...change },
        })),
      { key },
    )
  }
  async function run() {
    if (busy || problem || !model) return
    setBusy(true)
    try {
      if (!node.text_settings) patch({ model_id: model.id })
      await textRuns.submit({ node_id: node.id, model_id: model.id, reasoning, n: settings.n })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Composer
      {...props}
      node={node}
      label={t('canvas.prompt.textEditor')}
      model={model?.id ?? ''}
      options={models.items.map((item) => ({ id: item.id, name: item.display_name }))}
      onModel={(id) => patch({ model_id: id, reasoning: '' })}
      parameters={
        <div className="flex flex-wrap gap-3 text-xs">
          <label className="grid gap-1">
            {t('canvas.prompt.reasoning')}
            <select
              value={reasoning}
              className={selectClass}
              disabled={!model?.capabilities.reasoning_effort}
              onChange={(event) => {
                const value = event.target.value
                if (value === '' || value === 'low' || value === 'medium' || value === 'high')
                  patch({ reasoning: value })
              }}
            >
              <option value="">{t('canvas.prompt.auto')}</option>
              <option value="low">{t('credits.low')}</option>
              <option value="medium">{t('credits.medium')}</option>
              <option value="high">{t('credits.high')}</option>
            </select>
          </label>
          <label className="grid gap-1">
            {t('canvas.prompt.candidates')}
            <select
              value={settings.n}
              className={selectClass}
              onChange={(event) => patch({ n: Number(event.target.value) })}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
      footer={
        problem ? (
          <p role="status" className="text-xs text-warning">
            {t(problem)}
          </p>
        ) : null
      }
      busy={busy}
      disabled={busy || !!problem}
      onRun={() => void run()}
    >
      <CanvasPrompt
        node={node}
        value={settings.prompt}
        mentions={settings.mentions ?? []}
        onChange={(prompt, mentions) => patch({ prompt, mentions }, 'text-prompt:' + node.id)}
        onSend={() => void run()}
        placeholder={t('canvas.prompt.textPlaceholder')}
      />
    </Composer>
  )
}
