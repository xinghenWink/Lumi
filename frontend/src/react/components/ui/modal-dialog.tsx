import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { Button } from './button'

export type ModalVariant = 'default' | 'wide' | 'sheet' | 'fullscreen'

const contentClass: Record<ModalVariant, string> = {
  default:
    'top-1/2 left-1/2 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 shadow-lg animate-rise-in sm:p-6',
  wide: 'top-1/2 left-1/2 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-5xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 shadow-lg animate-rise-in sm:p-6',
  sheet:
    'inset-x-0 bottom-0 max-h-[min(88dvh,640px)] w-full rounded-t-3xl border-t border-border bg-card px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] shadow-lg animate-sheet-in sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[calc(100vw-32px)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-6 sm:pb-6 sm:animate-rise-in',
  fullscreen: 'inset-0 flex flex-col bg-scrim text-white animate-fade-in',
}

export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  returnFocus,
  wide = false,
  variant,
  className,
  children,
}: {
  open: boolean
  onOpenChange(value: boolean): void
  title: string
  description: string
  busy?: boolean
  returnFocus?: RefObject<HTMLElement | null>
  /** Kept for existing call sites; equivalent to `variant="wide"`. */
  wide?: boolean
  variant?: ModalVariant
  className?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const kind: ModalVariant = variant ?? (wide ? 'wide' : 'default')
  const immersive = kind === 'fullscreen'
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <Dialog.Portal>
        {/* A static overlay element keeps the self-only style-element CSP intact. */}
        <div
          aria-hidden="true"
          className={cn(
            'fixed inset-0 z-50 touch-none animate-fade-in',
            immersive ? 'bg-scrim' : 'bg-overlay backdrop-blur-[2px]',
          )}
        />
        <Dialog.Content
          data-lumi-modal
          data-variant={kind}
          className={cn(
            'fixed z-60 overflow-auto overscroll-contain text-foreground outline-none',
            contentClass[kind],
            className,
          )}
          onCloseAutoFocus={(event) => {
            if (returnFocus?.current) {
              event.preventDefault()
              returnFocus.current.focus()
            }
          }}
        >
          {kind === 'sheet' ? (
            <div
              aria-hidden="true"
              className="mx-auto mb-4 h-1 w-10 rounded-full bg-input sm:hidden"
            />
          ) : null}
          <Dialog.Title
            className={immersive ? 'sr-only' : 'pr-10 text-base font-semibold tracking-tight'}
          >
            {title}
          </Dialog.Title>
          <Dialog.Description
            className={
              immersive ? 'sr-only' : 'mt-1.5 mb-5 text-xs leading-5 text-muted-foreground'
            }
          >
            {description}
          </Dialog.Description>
          <Dialog.Close asChild>
            <Button
              type="button"
              disabled={busy}
              variant="ghost"
              size="icon"
              className={cn(
                'absolute z-10 size-9 rounded-full',
                immersive
                  ? 'top-3 right-3 bg-white/10 text-white hover:bg-white/20 hover:text-white'
                  : 'top-3.5 right-3.5',
              )}
              aria-label={t('common.close')}
            >
              <X size={18} />
            </Button>
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
