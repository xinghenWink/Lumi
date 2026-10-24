import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../../api/chat'
import { lastMessage } from '../../../features/chat/messages'
import { MessageCard } from './MessageCard'
import { Button } from '../ui/button'

export function MessageList({
  items,
  busy,
  hasOlder,
  loadingOlder,
  onOlder,
  onEdit,
  onRegenerate,
}: {
  items: Message[]
  busy: boolean
  hasOlder: boolean
  loadingOlder: boolean
  onOlder(): Promise<void>
  onEdit(message: Message): void
  onRegenerate(): void
}) {
  'use no memo'
  // TanStack Virtual exposes mutable getters; keep this boundary outside compiler memoization.
  const { t } = useTranslation()
  const scroller = useRef<HTMLDivElement>(null),
    body = useRef<HTMLDivElement>(null)
  const follow = useRef(true),
    frame = useRef<number | undefined>(undefined)
  const [following, setFollowing] = useState(true)
  const enabled = items.length > 100
  const getKey = useCallback((index: number) => items[index]?.id ?? index, [items])
  // eslint-disable-next-line react-hooks/incompatible-library -- Mutable getters are confined to this non-compiled boundary.
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 180,
    overscan: 6,
    enabled,
    getItemKey: getKey,
    useFlushSync: false,
  })
  const lastUser = lastMessage(items, 'user')?.id,
    lastAssistant = lastMessage(items, 'assistant')?.id
  const schedule = useCallback(() => {
    if (frame.current !== undefined) return
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      if (follow.current && scroller.current)
        scroller.current.scrollTop = scroller.current.scrollHeight
    })
  }, [])
  useLayoutEffect(() => {
    if (follow.current) schedule()
  }, [items, schedule])
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (follow.current) schedule()
    })
    if (body.current) observer.observe(body.current)
    schedule()
    return () => {
      observer.disconnect()
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current)
        frame.current = undefined
      }
    }
  }, [schedule])
  async function older() {
    const before = scroller.current
    if (!before) return
    const height = before.scrollHeight,
      top = before.scrollTop
    follow.current = false
    await onOlder()
    requestAnimationFrame(() => {
      if (scroller.current)
        scroller.current.scrollTop = top + scroller.current.scrollHeight - height
    })
  }
  const card = (message: Message) => (
    <MessageCard
      key={message.id}
      message={message}
      busy={busy}
      lastUser={message.id === lastUser}
      lastAssistant={message.id === lastAssistant}
      onEdit={onEdit}
      onRegenerate={onRegenerate}
    />
  )
  return (
    <div className="chat-message-region relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="chat-message-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8"
        aria-label={t('chat.messages')}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64
          setFollowing(follow.current)
        }}
      >
        <div ref={body} className="chat-message-body mx-auto w-full max-w-3xl pb-5">
          {hasOlder ? (
            <div className="flex justify-center py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loadingOlder}
                onClick={() => {
                  void older()
                }}
              >
                {t('chat.older')}
              </Button>
            </div>
          ) : null}
          {enabled ? (
            <div
              className="chat-virtual-messages relative w-full"
              style={{ height: virtual.getTotalSize() }}
            >
              {virtual.getVirtualItems().map((row) => {
                const message = items[row.index]
                return (
                  <div
                    key={row.key}
                    data-index={row.index}
                    ref={virtual.measureElement}
                    className="chat-virtual-row absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    {message ? card(message) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            items.map(card)
          )}
          <div className="h-px" aria-hidden="true" />
        </div>
      </div>
      {!following ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute right-4 bottom-4 shadow-sm"
          onClick={() => {
            follow.current = true
            setFollowing(true)
            schedule()
          }}
        >
          <ArrowDown size={14} />
          {t('chat.latest')}
        </Button>
      ) : null}
    </div>
  )
}
