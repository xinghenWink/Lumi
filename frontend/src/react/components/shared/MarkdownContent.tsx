import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderMarkdown } from '../../../features/chat/markdown'

export const MarkdownContent = memo(function MarkdownContent({
  content,
  complete = true,
}: {
  content: string
  complete?: boolean
}) {
  const { t } = useTranslation()
  const [rendered, setRendered] = useState<{ source: string; html: string } | null>(null)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    void renderMarkdown(content, complete, t('chat.copy'))
      .then((html) => {
        if (live) setRendered({ source: content, html })
      })
      .catch(() => {
        /* Keep the escaped source visible when an optional renderer cannot load. */
      })
    return () => {
      live = false
    }
  }, [content, complete, t])
  async function copy(target: EventTarget | null) {
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLButtonElement>('[data-copy-code]')
    if (!button || !container.current?.contains(button)) return
    const code = button.closest('.chat-code')?.querySelector('code')?.textContent
    if (code)
      try {
        await navigator.clipboard.writeText(code)
      } catch {
        /* Clipboard permissions remain browser controlled. */
      }
  }
  return rendered?.source === content ? (
    <div
      ref={container}
      className="chat-markdown min-w-0 break-words text-sm leading-7 [&_pre]:overflow-x-auto [&_a]:text-primary"
      onClick={(event) => {
        void copy(event.target)
      }}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  ) : (
    <div className="whitespace-pre-wrap break-words text-sm leading-7">{content}</div>
  )
})
