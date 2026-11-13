import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { CanvasSummary } from '../../../api/canvases'
import { LIMITS } from '../../../features/canvas/document'
import { useCanvasMutations } from '../../features/canvas/queries'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ModalDialog } from '../ui/modal-dialog'
import { cn } from '../../lib/utils'

const item =
  'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-xs outline-none focus:bg-accent focus:text-primary'

/**
 * Rename and delete for one canvas. The open canvas renames from its own title field,
 * because renaming here would bump the version under the editor and force a conflict.
 */
export function CanvasActions({ row, className }: { row: CanvasSummary; className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { rename, remove } = useCanvasMutations()
  const trigger = useRef<HTMLButtonElement>(null)
  const [modal, setModal] = useState<'rename' | 'delete' | ''>('')
  const [title, setTitle] = useState('')
  const open = location.pathname === '/canvas/' + row.id
  const name = row.title || t('canvas.list.untitled')
  const busy = rename.isPending || remove.isPending
  const error = modal === 'rename' ? rename.error : remove.error

  async function submit() {
    if (modal === 'rename') {
      await rename.mutateAsync({ row, title: title.trim() })
    } else {
      // Leave first so the editor's final save cannot race the deletion into a conflict.
      if (open) await navigate('/canvas', { replace: true })
      await remove.mutateAsync(row.id)
    }
    setModal('')
  }

  return (
    <>
      <Dropdown.Root modal={false}>
        <Dropdown.Trigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon"
            className={cn('size-8', className)}
            aria-label={t('canvas.list.actions') + ' · ' + name}
          >
            <MoreHorizontal size={16} />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            side="bottom"
            align="end"
            collisionPadding={12}
            className="z-70 w-44 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl"
          >
            {!open ? (
              <Dropdown.Item
                className={item}
                onSelect={() => {
                  rename.reset()
                  setTitle(row.title)
                  setModal('rename')
                }}
              >
                <Pencil size={14} />
                {t('canvas.list.rename')}
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item
              className={item + ' text-destructive'}
              onSelect={() => {
                remove.reset()
                setModal('delete')
              }}
            >
              <Trash2 size={14} />
              {t('canvas.list.remove')}
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      <ModalDialog
        open={!!modal}
        onOpenChange={(value) => {
          if (!value && !busy) setModal('')
        }}
        title={t(modal === 'rename' ? 'canvas.list.renameTitle' : 'canvas.list.removeTitle')}
        description={t(
          modal === 'rename' ? 'canvas.list.renameDescription' : 'canvas.list.removeDescription',
        )}
        busy={busy}
        returnFocus={trigger}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            // Errors render from the mutation state below.
            submit().catch(() => undefined)
          }}
        >
          <ApiNotice error={error} />
          {modal === 'rename' ? (
            <label className="flex flex-col gap-2 text-sm">
              {t('canvas.list.titleLabel')}
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={LIMITS.title}
                disabled={busy}
                autoFocus
              />
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setModal('')}>
              {t('canvas.list.cancel')}
            </Button>
            <Button
              type="submit"
              variant={modal === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
            >
              {t(modal === 'delete' ? 'canvas.list.confirmRemove' : 'canvas.list.save')}
            </Button>
          </div>
        </form>
      </ModalDialog>
    </>
  )
}
