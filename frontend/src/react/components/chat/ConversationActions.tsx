import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Download, MoreHorizontal, Pencil, Pin, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Conversation } from '../../../api/chat'
import { operations } from '../../../api/operations'
import { useRuntime } from '../../app/context'
import { ApiNotice } from '../shared/ApiNotice'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type Action =
  | { kind: 'rename'; title: string }
  | { kind: 'delete' }
  | { kind: 'pin' }
  | { kind: 'export'; format: 'json' | 'markdown' }
export function ConversationActions({ row }: { row: Conversation }) {
  const { t } = useTranslation()
  const runtime = useRuntime(),
    navigate = useNavigate(),
    location = useLocation()
  const trigger = useRef<HTMLButtonElement>(null)
  const [modal, setModal] = useState<'rename' | 'delete' | ''>(''),
    [title, setTitle] = useState('')
  const mutation = useMutation({
    mutationFn: async (action: Action) => {
      if (action.kind === 'export') return operations.exportChats(action.format, row.id)
      if (action.kind === 'delete') {
        await runtime.chat.remove([row.id])
        if (location.pathname === '/chat/' + row.id) await navigate('/chat', { replace: true })
      } else
        await runtime.chat.update(
          row,
          action.kind === 'rename' ? action.title.trim() : row.title || t('chat.untitled'),
          action.kind === 'pin' ? !row.pinned : row.pinned,
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
            aria-label={t('chat.actions', { name: row.title || t('chat.untitled') })}
          >
            <MoreHorizontal size={16} />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            side="bottom"
            align="end"
            collisionPadding={12}
            aria-label={t('chat.more')}
            className="z-70 w-52 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl"
          >
            <Dropdown.Item
              className={item}
              onSelect={() => {
                setTitle(row.title || t('chat.untitled'))
                mutation.reset()
                setModal('rename')
              }}
            >
              <Pencil size={14} />
              {t('chat.rename')}
            </Dropdown.Item>
            <Dropdown.Item
              className={item}
              disabled={mutation.isPending}
              onSelect={() => mutation.mutate({ kind: 'pin' })}
            >
              <Pin size={14} />
              {t(row.pinned ? 'chat.unpin' : 'chat.pin')}
            </Dropdown.Item>
            {(['json', 'markdown'] as const).map((format) => (
              <Dropdown.Item
                key={format}
                className={item}
                disabled={mutation.isPending}
                onSelect={() => mutation.mutate({ kind: 'export', format })}
              >
                <Download size={14} />
                {t(format === 'json' ? 'ops.exportJSON' : 'ops.exportMarkdown')}
              </Dropdown.Item>
            ))}
            <Dropdown.Separator className="my-1 h-px bg-border" />
            <Dropdown.Item
              className={item + ' text-destructive'}
              onSelect={() => {
                mutation.reset()
                setModal('delete')
              }}
            >
              <Trash2 size={14} />
              {t('chat.delete')}
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
        title={t(modal === 'rename' ? 'chat.renameTitle' : 'chat.deleteTitle')}
        description={t(modal === 'rename' ? 'chat.historyHint' : 'chat.deleteHint')}
        busy={mutation.isPending}
        returnFocus={trigger}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate(modal === 'rename' ? { kind: 'rename', title } : { kind: 'delete' })
          }}
        >
          <ApiNotice error={mutation.error} />
          {modal === 'rename' ? (
            <label className="flex flex-col gap-2 text-sm">
              {t('chat.name')}
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={100}
                required
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
              {t(modal === 'delete' ? 'chat.confirmDelete' : 'chat.save')}
            </Button>
          </div>
        </form>
      </ModalDialog>
    </>
  )
}
