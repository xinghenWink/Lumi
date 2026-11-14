import { useId, useRef, useState } from 'react'
import { Image as ImageIcon, Plus, Type, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CanvasMention, CanvasNode } from '../../../api/canvases'
import { canConnect, connect, removeEdges } from '../../../features/canvas/commands'
import { missingMentions, referenceNodes } from '../../../features/canvas/workflow'
import { useCanvas, useCanvasImage, useEditor } from '../../features/canvas/context'
import { ModalDialog } from '../ui/modal-dialog'

const noMentions: CanvasMention[] = []

function label(node: CanvasNode, index: number, t: ReturnType<typeof useTranslation>['t']) {
  return (
    node.title ||
    t(node.kind === 'image' ? 'canvas.prompt.imageLabel' : 'canvas.prompt.textLabel', {
      index: index + 1,
    })
  )
}

function ResourceIcon({ node }: { node: CanvasNode }) {
  const file = useEditor((state) =>
    node.image?.file_id ? state.files[node.image.file_id] : undefined,
  )
  const thumb = useCanvasImage(file, 'thumb')
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
      {thumb?.url ? (
        <img src={thumb.url} alt="" className="size-full object-cover" />
      ) : node.kind === 'image' ? (
        <ImageIcon size={17} />
      ) : (
        <Type size={17} />
      )}
    </span>
  )
}

export function CanvasPrompt({
  node,
  value,
  mentions = noMentions,
  onChange,
  onSend,
  placeholder,
}: {
  node: CanvasNode
  value: string
  mentions?: CanvasMention[]
  onChange(value: string, mentions: CanvasMention[]): void
  onSend(): void
  placeholder: string
}) {
  const { t } = useTranslation()
  const { editor } = useCanvas()
  const doc = useEditor((state) => state.doc)
  const files = useEditor((state) => state.files)
  const field = useRef<HTMLTextAreaElement>(null)
  const listID = useId()
  const [match, setMatch] = useState<{ start: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [picker, setPicker] = useState(false)
  const [search, setSearch] = useState('')
  const connected = referenceNodes(doc, node.id, true)
  const usable = (candidate: CanvasNode) =>
    !!candidate.text?.content.trim() ||
    (candidate.image?.state === 'ready' &&
      !!candidate.image.file_id &&
      !!files[candidate.image.file_id])
  const choices = connected.flatMap((candidate, index) => {
    const name = label(candidate, index, t)
    return match &&
      candidate.id !== node.id &&
      usable(candidate) &&
      (name + ' ' + (candidate.text?.content ?? ''))
        .toLowerCase()
        .includes(match.query.toLowerCase())
      ? [{ candidate, name }]
      : []
  })
  const missing = missingMentions(connected, mentions, (id) => !!files[id])
  const all = doc.nodes.filter((candidate) => candidate.id !== node.id && usable(candidate))

  function findMatch(text: string, end: number) {
    const input = /@([^\s@[\]]*)$/.exec(text.slice(0, end))
    setMatch(input ? { start: end - (input[1]?.length ?? 0) - 1, query: input[1] ?? '' } : null)
    setHighlight(0)
  }

  function insert(candidate: CanvasNode, name: string) {
    if (!match) return
    const existing = mentions.find((item) => item.node_id === candidate.id)
    const safeName =
      [...name.replace(/[[\]\r\n]/g, '')].slice(0, 30).join('') || t('canvas.prompt.resource')
    let token = existing?.token ?? '@[' + safeName + ']'
    for (let suffix = 2; !existing && mentions.some((item) => item.token === token); suffix++) {
      token = '@[' + safeName + ' ' + suffix + ']'
    }
    const end = field.current?.selectionEnd ?? match.start + match.query.length + 1
    const head = value.slice(0, match.start) + token + ' '
    const updated = head + value.slice(end)
    if (updated.length > 8000) return
    onChange(updated, existing ? mentions : [...mentions, { node_id: candidate.id, token }])
    setMatch(null)
    requestAnimationFrame(() => {
      field.current?.focus()
      field.current?.setSelectionRange(head.length, head.length)
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t('canvas.prompt.references')}</p>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {connected.map((candidate, index) => {
          const name = label(candidate, index, t)
          const edge = doc.edges.find(
            (item) => item.kind === 'input' && item.to === node.id && item.from === candidate.id,
          )
          return (
            <div key={candidate.id} title={name} className="group/ref relative shrink-0">
              <ResourceIcon node={candidate} />
              {edge ? (
                <button
                  type="button"
                  aria-label={t('canvas.prompt.disconnect', { name })}
                  className="absolute top-0 right-0 grid size-5 place-items-center rounded-full bg-card text-foreground sm:opacity-0 sm:group-hover/ref:opacity-100 sm:focus-visible:opacity-100"
                  onClick={() => editor.apply((current) => removeEdges(current, [edge.id]))}
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          )
        })}
        <button
          type="button"
          aria-label={t('canvas.prompt.addReference')}
          onClick={() => {
            setSearch('')
            setPicker(true)
          }}
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-border hover:bg-muted"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="relative">
        <textarea
          ref={field}
          aria-label={t('canvas.generator.prompt')}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={match ? listID : undefined}
          aria-activedescendant={
            choices.length ? listID + '-' + Math.min(highlight, choices.length - 1) : undefined
          }
          value={value}
          maxLength={8000}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.currentTarget.value
            onChange(
              next,
              mentions.filter((item) => next.includes(item.token)),
            )
            findMatch(next, event.currentTarget.selectionEnd)
          }}
          onClick={(event) =>
            findMatch(event.currentTarget.value, event.currentTarget.selectionEnd)
          }
          onBlur={(event) => {
            if (!event.relatedTarget?.closest('[data-canvas-mentions]')) setMatch(null)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (match && event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setMatch(null)
              return
            }
            if (
              match &&
              choices.length &&
              ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)
            ) {
              event.preventDefault()
              const index = Math.min(highlight, choices.length - 1)
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const next =
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
                setHighlight(next)
                document.getElementById(listID + '-' + next)?.scrollIntoView({ block: 'nearest' })
              } else {
                const choice = choices[index]
                if (choice) insert(choice.candidate, choice.name)
              }
              return
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              onSend()
            }
          }}
          className="h-32 w-full resize-none rounded-lg bg-transparent px-2 py-2 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {match ? (
          <div
            id={listID}
            role="listbox"
            aria-label={t('canvas.prompt.mentions')}
            data-canvas-mentions
            className="absolute right-1 top-10 z-30 grid max-h-40 w-64 max-w-full gap-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl"
          >
            {choices.length ? (
              choices.map(({ candidate, name }, index) => (
                <button
                  key={candidate.id}
                  id={listID + '-' + index}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(candidate, name)}
                  className="flex items-center gap-2 rounded-lg p-1 text-left text-sm hover:bg-muted aria-selected:bg-muted"
                >
                  <ResourceIcon node={candidate} />
                  <span className="min-w-0">
                    <span className="block truncate">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {candidate.text?.content}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p role="status" className="p-2 text-xs text-muted-foreground">
                {t('canvas.prompt.noMatches')}
              </p>
            )}
          </div>
        ) : null}
      </div>
      {mentions.length ? (
        <div className="flex flex-wrap gap-1">
          {mentions.map((mention) => {
            const candidate = connected.find((item) => item.id === mention.node_id)
            const broken = missing.includes(mention)
            return (
              <button
                key={mention.token}
                type="button"
                aria-label={t('canvas.prompt.removeMention', { name: mention.token })}
                onClick={() =>
                  onChange(
                    value.split(mention.token).join(''),
                    mentions.filter((item) => item !== mention),
                  )
                }
                className="flex max-w-full items-center gap-1 rounded-md border border-border px-1 text-xs hover:bg-muted"
              >
                {candidate?.kind === 'image' && !broken ? <ResourceIcon node={candidate} /> : null}
                <span className={broken ? 'truncate text-destructive' : 'truncate'}>
                  {broken ? t('canvas.prompt.missing', { name: mention.token }) : mention.token}
                </span>
                <X size={12} />
              </button>
            )
          })}
        </div>
      ) : null}
      {picker ? (
        <ModalDialog
          open
          title={t('canvas.prompt.addReference')}
          description={t('canvas.prompt.pickDescription')}
          onOpenChange={setPicker}
        >
          <input
            aria-label={t('canvas.prompt.search')}
            placeholder={t('canvas.prompt.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mb-2 w-full rounded-lg border border-border bg-background p-2 text-sm"
          />
          <div className="grid max-h-72 gap-1 overflow-y-auto">
            {all.map((candidate, index) => {
              const name = label(candidate, index, t)
              if (
                !(name + ' ' + (candidate.text?.content ?? ''))
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
                return null
              const linked = connected.some((item) => item.id === candidate.id)
              return (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={linked || !canConnect(doc, candidate.id, node.id)}
                  className="flex min-w-0 items-center gap-2 rounded-lg p-1 text-left text-sm hover:bg-muted disabled:opacity-60"
                  onClick={() => {
                    if (editor.apply((current) => connect(current, candidate.id, node.id)))
                      setPicker(false)
                  }}
                >
                  <ResourceIcon node={candidate} />
                  <span className="min-w-0 truncate">
                    {name} {candidate.text?.content}
                  </span>
                </button>
              )
            })}
          </div>
        </ModalDialog>
      ) : null}
    </div>
  )
}
