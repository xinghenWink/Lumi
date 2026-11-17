import * as React from 'react'
import { cn } from '../../lib/utils'
import { DialogContent } from './dialog'
import * as SheetPrimitive from '@radix-ui/react-dialog'

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetContent({
  className,
  side = 'left',
  ...props
}: React.ComponentProps<typeof DialogContent> & { side?: 'left' | 'right' }) {
  return (
    <DialogContent
      data-slot="sheet-content"
      overlayClassName="z-40"
      className={cn(
        'z-50 inset-y-0 flex w-[280px] max-w-[calc(100vw-20px)] flex-col border-border bg-sidebar shadow-lg',
        side === 'right' ? 'right-0 border-l animate-fade-in' : 'left-0 border-r animate-drawer-in',
        className,
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription }
