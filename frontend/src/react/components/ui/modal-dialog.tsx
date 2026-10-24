import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './button'

export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  returnFocus,
  wide = false,
  children,
}: {
  open: boolean
  onOpenChange(value: boolean): void
  title: string
  description: string
  busy?: boolean
  returnFocus?: RefObject<HTMLElement | null>
  wide?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <Dialog.Portal>
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 touch-none bg-black/35 backdrop-blur-[2px]"
        />
        <Dialog.Content
          data-lumi-modal
          className={`fixed top-1/2 left-1/2 z-60 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] ${wide ? 'max-w-5xl' : 'max-w-lg'} -translate-x-1/2 -translate-y-1/2 overflow-auto overscroll-contain rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl outline-none sm:p-6`}
          onCloseAutoFocus={(event) => {
            if (returnFocus?.current) {
              event.preventDefault()
              returnFocus.current.focus()
            }
          }}
        >
          <Dialog.Title className="pr-8 text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 mb-5 text-xs leading-6 text-muted-foreground">
            {description}
          </Dialog.Description>
          <Dialog.Close asChild>
            <Button
              type="button"
              disabled={busy}
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3"
              aria-label={t('common.cancel')}
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
