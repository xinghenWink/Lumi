import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  partitionMarkdown,
  renderMarkdown,
  type Illustration,
} from '../../../features/chat/markdown'

const MarkdownBlock = memo(function MarkdownBlock({
  source,
  complete,
  actionable,
}: {
  source: string
  complete: boolean
  actionable: boolean
}) {
  const { t } = useTranslation()
  const [html, setHTML] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void renderMarkdown(source, complete, t('chat.copyCode'), {
      label: t('react.illustration'),
      pending: t('react.illustrationPending'),
      ...(actionable ? { action: t('react.illustrationGenerate') } : {}),
    })
      .then((rendered) => {
        if (live) setHTML(rendered)
      })
      .catch(() => {
        /* Preserve escaped source if the optional renderer cannot load. */
      })
    return () => {
      live = false
    }
  }, [source, complete, actionable, t])
  // Only the shared DOMPurify renderer supplies HTML to this sink.
  return html === null ? (
    <div className="whitespace-pre-wrap">{source}</div>
  ) : (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  )
})

export const MarkdownContent = memo(function MarkdownContent({
  content,
  complete = true,
  onIllustration,
}: {
  content: string
  complete?: boolean
  /** Enables the generate button on model-suggested illustrations. */
  onIllustration?: (illustration: Illustration) => void
}) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const parts = partitionMarkdown(content, complete)
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
      {parts.map((part) => (
        <MarkdownBlock
          key={part.key}
          source={part.source}
          complete={part.complete}
          actionable={!!onIllustration}
        />
      ))}
    </div>
  )
})
