import * as Dialog from '@radix-ui/react-dialog'
import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { Button } from '../ui/button'

export function MobileNavigation({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  useEffect(() => {
    if (!open) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [open])
  useEffect(() => {
    if (admin) return
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (window.matchMedia('(max-width: 1023px)').matches) setOpen(true)
      requestAnimationFrame(() => {
        document.querySelectorAll<HTMLInputElement>('[data-history-search]').forEach((input) => {
          if (input.getClientRects().length) input.focus()
        })
      })
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [admin])
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          className="lg:hidden"
          variant="ghost"
          size="icon"
          aria-label={t('nav.openMenu')}
        >
          <Menu size={20} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        {/* Static CSS preserves the existing self-only style-element policy. */}
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 touch-none bg-black/35 backdrop-blur-[2px]"
        />
        <Dialog.Content className="mobile-sidebar fixed inset-y-0 left-0 z-50 w-[268px] max-w-[calc(100vw-20px)] border-r border-border bg-sidebar shadow-xl outline-none">
          <Dialog.Title className="sr-only">
            {t(admin ? 'nav.admin' : 'nav.workspace')}
          </Dialog.Title>
          <Dialog.Description className="sr-only">{t('nav.openMenu')}</Dialog.Description>
          <Dialog.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-3 right-2 z-10"
              aria-label={t('nav.closeMenu')}
            >
              <X size={18} />
            </Button>
          </Dialog.Close>
          <Sidebar admin={admin} onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
