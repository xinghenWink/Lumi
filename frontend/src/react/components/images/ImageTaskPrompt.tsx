import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'

const hoverDelay = 160

function PromptText({ prompt, scrollRef }: { prompt: string; scrollRef: Ref<HTMLDivElement> }) {
  const { t } = useTranslation()
  const [copyStatus, setCopyStatus] = useState<'common.copied' | 'common.copyFailed' | null>(null)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyStatus('common.copied')
    } catch {
      setCopyStatus('common.copyFailed')
    }
  }

  return (
    <>
      <div
        ref={scrollRef}
        role="region"
        aria-label={t('images.prompt')}
        tabIndex={0}
        className="overflow-y-auto overscroll-contain rounded-t-xl px-3 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <p className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap select-text">{prompt}</p>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
        <span role="status" className="pl-1 text-xs text-muted-foreground">
          {copyStatus ? t(copyStatus) : null}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copyPrompt()}>
          <Copy aria-hidden="true" size={14} />
          {t('images.copyPrompt')}
        </Button>
      </div>
    </>
  )
}

export function ImageTaskPrompt({ prompt }: { prompt: string }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'hover' | 'activated' | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const restoreFocus = useRef(false)
  const scrollRegion = useRef<HTMLDivElement>(null)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function onPointerEnter(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    window.clearTimeout(timer.current)
    if (mode === null) {
      timer.current = window.setTimeout(() => {
        restoreFocus.current = false
        setMode('hover')
      }, hoverDelay)
    }
  }

  function onPointerLeave(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    window.clearTimeout(timer.current)
    if (mode === 'hover') {
      // Allow the pointer to cross the gap between the trigger and the floating panel.
      timer.current = window.setTimeout(() => {
        setMode((current) => (current === 'hover' ? null : current))
      }, hoverDelay)
    }
  }

  return (
    <Popover.Root
      open={mode !== null}
      onOpenChange={(open) => {
        window.clearTimeout(timer.current)
        if (open) restoreFocus.current = true
        setMode(open ? 'activated' : null)
      }}
    >
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('images.fullPrompt')}
          className="-mx-2 h-auto w-[calc(100%+1rem)] items-start justify-between px-2 py-1 text-left font-normal"
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onClick={(event) => {
            if (mode !== 'hover') return
            event.preventDefault()
            scrollRegion.current?.focus()
          }}
        >
          <span className="line-clamp-2 min-w-0 leading-6 wrap-anywhere whitespace-pre-wrap text-foreground">
            {prompt}
          </span>
          <ChevronDown aria-hidden="true" size={14} className="mt-1.5" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          aria-label={t('images.fullPrompt')}
          className="z-30 grid max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[max(20rem,var(--radix-popover-trigger-width))] max-w-[min(44rem,var(--radix-popover-content-available-width))] grid-rows-[minmax(0,1fr)_auto] rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onFocusCapture={() => {
            restoreFocus.current = true
            setMode('activated')
          }}
          onOpenAutoFocus={(event) => {
            if (mode === 'hover') event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            if (!restoreFocus.current) event.preventDefault()
          }}
        >
          <PromptText prompt={prompt} scrollRef={scrollRegion} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
