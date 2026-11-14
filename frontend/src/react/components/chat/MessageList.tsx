import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../../api/chat'
import { lastMessage } from '../../../features/chat/messages'
import { MessageCard } from './MessageCard'
import { Button } from '../ui/button'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '../ui/message-scroller'

const olderRowHeight = 60

interface ReadingPosition {
  id: string
  offset: number
}

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
  const viewport = useRef<HTMLDivElement>(null)
  const scrollerBody = useRef<HTMLDivElement>(null)
  const [readingPosition, setReadingPosition] = useState<ReadingPosition | null>(null)
  const measuredRows = useRef(new Map<string, number>())
  const virtualized = items.length > 100
  const anchorIndex = readingPosition
    ? items.findIndex((item) => item.id === readingPosition.id)
    : -1
  const getKey = useCallback((index: number) => items[index]?.id ?? index, [items])
  // eslint-disable-next-line react-hooks/incompatible-library -- Mutable getters are confined to this non-compiled boundary.
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => {
      const item = items[index]
      return (item && measuredRows.current.get(item.id)) ?? 180
    },
    overscan: 6,
    enabled: virtualized,
    getItemKey: getKey,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range)
      return anchorIndex < 0 || visible.includes(anchorIndex)
        ? visible
        : [...visible, anchorIndex].sort((left, right) => left - right)
    },
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 64,
    scrollMargin: hasOlder ? olderRowHeight : 0,
    scrollPaddingStart: readingPosition?.offset ?? 0,
    paddingEnd: 24,
    useFlushSync: false,
  })
  useLayoutEffect(() => {
    if (!virtualized) return
    const element = viewport.current
    if (!element || anchorIndex < 0 || !readingPosition) {
      virtual.scrollToEnd()
      return
    }
    virtual.scrollToIndex(anchorIndex, { align: 'start' })

    // Keep the original row mounted until its estimated neighbors settle.
    const timeout = window.setTimeout(release, 650)
    let frame = requestAnimationFrame(restore)
    function restore() {
      const row = scrollerBody.current?.querySelector<HTMLElement>(
        '[data-index="' + anchorIndex + '"]',
      )
      if (row && element && readingPosition) {
        const delta =
          row.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          readingPosition.offset
        if (Math.abs(delta) > 1) element.scrollTop += delta
      }
      frame = requestAnimationFrame(restore)
    }
    function release() {
      cleanup()
      setReadingPosition(null)
    }
    function cleanup() {
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      element?.removeEventListener('wheel', release)
      element?.removeEventListener('touchmove', release)
      element?.removeEventListener('keydown', release)
      element?.removeEventListener('pointerdown', release)
    }
    element.addEventListener('wheel', release, { passive: true })
    element.addEventListener('touchmove', release, { passive: true })
    element.addEventListener('keydown', release)
    element.addEventListener('pointerdown', release)
    return cleanup
    // The first virtual render needs an explicit scroll because there was no enabled
    // virtualizer to anchor the preceding commit. Subsequent changes are anchored internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only the mode transition needs a manual scroll.
  }, [virtualized])
  const lastUser = lastMessage(items, 'user')?.id
  const lastAssistant = lastMessage(items, 'assistant')?.id
  function older() {
    if (!virtualized && viewport.current) {
      const top = viewport.current.getBoundingClientRect().top
      const rows = scrollerBody.current?.querySelectorAll<HTMLElement>(
        '[data-slot="message-scroller-item"][data-message-id]',
      )
      let position: ReadingPosition | null = null
      measuredRows.current.clear()
      for (const row of rows ?? []) {
        const id = row.dataset.messageId
        if (!id) continue
        const bounds = row.getBoundingClientRect()
        measuredRows.current.set(id, bounds.height)
        if (!position && bounds.bottom > top) position = { id, offset: bounds.top - top }
      }
      setReadingPosition(position)
    }
    void onOlder()
  }
  const card = (message: Message) => (
    <MessageCard
      message={message}
      busy={busy}
      lastUser={message.id === lastUser}
      lastAssistant={message.id === lastAssistant}
      onEdit={onEdit}
      onRegenerate={onRegenerate}
    />
  )
  return (
    <MessageScrollerProvider autoScroll={!virtualized} scrollEdgeThreshold={64}>
      <MessageScroller className="chat-message-region size-auto flex-1">
        <MessageScrollerViewport
          ref={viewport}
          aria-label={t('chat.messages')}
          preserveScrollOnPrepend={!virtualized}
          className="chat-message-scroll h-auto flex-1 px-4 sm:px-6"
          style={virtualized ? { overflowAnchor: 'none' } : undefined}
        >
          <MessageScrollerContent
            ref={scrollerBody}
            className="chat-message-body mx-auto w-full max-w-3xl"
          >
            {hasOlder ? (
              <MessageScrollerItem
                className="flex items-center justify-center"
                style={{ height: olderRowHeight }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingOlder || (virtualized && !!readingPosition)}
                  onClick={older}
                >
                  {t('chat.older')}
                </Button>
              </MessageScrollerItem>
            ) : null}
            {virtualized ? (
              <MessageScrollerItem
                className="chat-virtual-messages relative w-full"
                style={{ height: virtual.getTotalSize() }}
              >
                {virtual.getVirtualItems().map((row) => {
                  const message = items[row.index]
                  return message ? (
                    <div
                      key={row.key}
                      data-index={row.index}
                      ref={virtual.measureElement}
                      className="chat-virtual-row absolute top-0 left-0 w-full"
                      style={{
                        transform: `translateY(${row.start - (hasOlder ? olderRowHeight : 0)}px)`,
                      }}
                    >
                      {card(message)}
                    </div>
                  ) : null
                })}
              </MessageScrollerItem>
            ) : (
              <>
                {items.map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    {card(message)}
                  </MessageScrollerItem>
                ))}
                <MessageScrollerItem aria-hidden="true" className="h-6" />
              </>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          behavior="auto"
          variant="outline"
          size="sm"
          className="rounded-full bg-card/95 shadow-md"
          onClick={(event) => {
            if (virtualized) {
              event.preventDefault()
              virtual.scrollToEnd()
              viewport.current?.focus({ preventScroll: true })
            }
          }}
        >
          <ArrowDown size={14} />
          {t('chat.latest')}
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
