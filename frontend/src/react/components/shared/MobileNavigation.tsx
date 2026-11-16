import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet'
import { Menu, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { Button } from '../ui/button'

export function MobileNavigation({
  admin,
  onDesktopSearch,
}: {
  admin: boolean
  onDesktopSearch(): void
}) {
  const [open, setOpen] = useState(false)
  const searchOnOpen = useRef(false)
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
      if (window.matchMedia('(min-width: 1024px)').matches) {
        onDesktopSearch()
      } else if (!open) {
        searchOnOpen.current = true
        setOpen(true)
      } else {
        document.querySelector<HTMLInputElement>('.mobile-sidebar [data-history-search]')?.focus()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [admin, onDesktopSearch, open])
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          className="lg:hidden"
          variant="ghost"
          size="icon"
          aria-label={t('nav.openMenu')}
        >
          <Menu size={20} />
        </Button>
      </SheetTrigger>
      <SheetContent
        className="mobile-sidebar"
        onOpenAutoFocus={(event) => {
          if (!searchOnOpen.current) return
          searchOnOpen.current = false
          const input = document.querySelector<HTMLInputElement>(
            '.mobile-sidebar [data-history-search]',
          )
          if (input) {
            event.preventDefault()
            input.focus()
          }
        }}
      >
        <SheetTitle className="sr-only">{t(admin ? 'nav.admin' : 'nav.workspace')}</SheetTitle>
        <SheetDescription className="sr-only">{t('nav.openMenu')}</SheetDescription>
        <SheetClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-4 right-2 z-10 size-9"
            aria-label={t('nav.closeMenu')}
          >
            <X size={18} />
          </Button>
        </SheetClose>
        <Sidebar admin={admin} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
