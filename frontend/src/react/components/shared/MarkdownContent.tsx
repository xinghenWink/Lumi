import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatSource } from '../../../api/chat'
import {
  partitionMarkdown,
  renderMarkdown,
  type Illustration,
} from '../../../features/chat/markdown'
import { parseAssistantReply, type ReplyDecoration } from '../../../features/chat/reply-markup'

const MarkdownBlock = memo(function MarkdownBlock({
  source,
  complete,
  actionable,
  decorations,
}: {
  source: string
  complete: boolean
  actionable: boolean
  decorations: readonly ReplyDecoration[] | undefined
}) {
  const { t } = useTranslation()
  const [html, setHTML] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void renderMarkdown(
      source,
      complete,
      t('chat.copyCode'),
      {
        label: t('react.illustration'),
        pending: t('react.illustrationPending'),
        ...(actionable ? { action: t('react.illustrationGenerate') } : {}),
      },
      decorations ? { decorations, unavailable: t('chat.sourceUnavailable') } : undefined,
    )
      .then((rendered) => {
        if (live) setHTML(rendered)
      })
      .catch(() => {
        if (live) setHTML(null)
      })
    return () => {
      live = false
    }
  }, [source, complete, actionable, decorations, t])
  // Only the shared DOMPurify renderer supplies HTML to this sink.
  return html === null ? (
    <div className="whitespace-pre-wrap">{decorations ? t('common.loading') : source}</div>
  ) : (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  )
})

export const MarkdownContent = memo(function MarkdownContent({
  content,
  complete = true,
  onIllustration,
  assistant = false,
  sources,
}: {
  content: string
  complete?: boolean
  /** Enables the generate button on model-suggested illustrations. */
  onIllustration?: (illustration: Illustration) => void
  assistant?: boolean
  sources?: readonly ChatSource[] | undefined
}) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const reply = useMemo(
    () =>
      assistant
        ? parseAssistantReply(content, complete, sources, {
            unavailable: t('chat.sourceUnavailable'),
            sources: t('chat.sources'),
          })
        : undefined,
    [assistant, content, complete, sources, t],
  )
  const sections = reply?.parts ?? [{ kind: 'markdown', source: content }]
  const decorations = reply?.decorations
  function sectionBlocks(source: string) {
    return partitionMarkdown(source, complete).map((part) => (
      <MarkdownBlock
        key={part.key}
        source={part.source}
        complete={part.complete}
        actionable={!!onIllustration}
        decorations={decorations?.length ? decorations : undefined}
      />
    ))
  }
  async function copy(target: Element) {
    const button = target.closest<HTMLButtonElement>('[data-copy-code]')
    if (!button || !container.current?.contains(button)) return
    const code = button.closest('.chat-code')?.querySelector('code')?.textContent
    if (code)
      try {
        await navigator.clipboard.writeText(code)
        button.textContent = t('chat.copied')
      } catch {
        button.textContent = t('chat.copyCode')
      }
  }
  function click(target: EventTarget | null) {
    if (!(target instanceof Element)) return
    const illustration = target.closest<HTMLButtonElement>('[data-illustration-prompt]')
    if (illustration && container.current?.contains(illustration)) {
      const prompt = illustration.dataset.illustrationPrompt ?? ''
      if (prompt) onIllustration?.({ prompt, ratio: illustration.dataset.illustrationRatio ?? '' })
      return
    }
    void copy(target)
  }
  return (
    <div
      ref={container}
      className="chat-markdown min-w-0 break-words text-sm leading-7"
      onClick={(event) => click(event.target)}
    >
      {sections.map((section, index) =>
        section.kind === 'reasoning' ? (
          <details key={index} className="chat-reasoning">
            <summary>{t('chat.reasoning')}</summary>
            <div>{sectionBlocks(section.source)}</div>
          </details>
        ) : (
          <div key={index}>{sectionBlocks(section.source)}</div>
        ),
      )}
    </div>
  )
})
