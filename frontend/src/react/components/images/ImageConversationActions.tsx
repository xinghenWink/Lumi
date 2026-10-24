import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Pencil, Pin, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ImageConversation } from '../../../api/images'
import { useRuntime } from '../../app/context'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ApiNotice } from '../shared/ApiNotice'

export function ImageConversationActions({ row }: { row: ImageConversation }) {
  const { t } = useTranslation(),
    runtime = useRuntime(),
    navigate = useNavigate(),
    location = useLocation()
  const trigger = useRef<HTMLButtonElement>(null)
  const [modal, setModal] = useState<'rename' | 'delete' | ''>(''),
    [title, setTitle] = useState('')
  const mutation = useMutation({
    mutationFn: async (action: 'rename' | 'delete' | 'pin') => {
      if (action === 'delete') {
        await runtime.image.remove(row.id)
        if (location.pathname === '/create/' + row.id) await navigate('/create', { replace: true })
      } else
        await runtime.image.update(
          row,
          action === 'rename' ? title.trim() : row.title || t('images.untitled'),
          action === 'pin' ? !row.pinned : row.pinned,
        )
    },
    onSuccess: () => setModal(''),
  })
  const item =
    'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-xs outline-none focus:bg-accent focus:text-primary'
  return (
    <>
      <Dropdown.Root modal={false}>
        <Dropdown.Trigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('chat.actions', { name: row.title || t('images.untitled') })}
          >
            <MoreHorizontal size={16} />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            side="bottom"
            align="end"
            collisionPadding={12}
            className="z-70 w-48 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl"
          >
            <Dropdown.Item
              className={item}
              onSelect={() => {
                mutation.reset()
                setTitle(row.title)
                setModal('rename')
              }}
            >
              <Pencil size={14} />
              {t('images.rename')}
            </Dropdown.Item>
            <Dropdown.Item
              className={item}
              disabled={mutation.isPending}
              onSelect={() => mutation.mutate('pin')}
            >
              <Pin size={14} />
              {t(row.pinned ? 'images.unpin' : 'images.pin')}
            </Dropdown.Item>
            <Dropdown.Separator className="my-1 h-px bg-border" />
            <Dropdown.Item
              className={item + ' text-destructive'}
              onSelect={() => {
                mutation.reset()
                setModal('delete')
              }}
            >
              <Trash2 size={14} />
              {t('common.delete')}
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      {!modal ? <ApiNotice error={mutation.error} /> : null}
      <ModalDialog
        open={!!modal}
        onOpenChange={(value) => {
          if (!value) setModal('')
        }}
        title={t(modal === 'rename' ? 'images.rename' : 'images.deleteConversation')}
        description={t(modal === 'rename' ? 'images.history' : 'images.deleteConversationHint')}
        busy={mutation.isPending}
        returnFocus={trigger}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (modal) mutation.mutate(modal)
          }}
        >
          <ApiNotice error={mutation.error} />
          {modal === 'rename' ? (
            <label className="flex flex-col gap-2 text-sm">
              {t('chat.name')}
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={100}
                disabled={mutation.isPending}
              />
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setModal('')}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant={modal === 'delete' ? 'destructive' : 'default'}
              disabled={mutation.isPending || (modal === 'rename' && !title.trim())}
            >
              {t(modal === 'delete' ? 'common.delete' : 'chat.save')}
            </Button>
          </div>
        </form>
      </ModalDialog>
    </>
  )
}
