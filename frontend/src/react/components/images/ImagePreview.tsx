import { useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageFile } from '../../../api/images'
import { useImageActions } from '../../features/images/actions'
import { ApiNotice } from '../shared/ApiNotice'
import { ModalDialog } from '../ui/modal-dialog'
import { Button } from '../ui/button'
import { ProtectedImage } from './ProtectedImage'

export function ImagePreview({
  files,
  initialIndex = 0,
  prompt,
  parameters,
  onClose,
  onEdit,
  onNavigate,
  returnFocus,
}: {
  files: ImageFile[]
  initialIndex?: number
  prompt: string
  parameters: string
  onClose(): void
  onEdit?: ((file: ImageFile) => void) | undefined
  onNavigate?: ((index: number) => void) | undefined
  returnFocus?: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation(),
    actions = useImageActions()
  const [index, setIndex] = useState(initialIndex),
    [zoom, setZoom] = useState(100)
  const file = files[index]
  function move(direction: number) {
    if (!files.length) return
    const next = (index + direction + files.length) % files.length
    setIndex(next)
    setZoom(100)
    onNavigate?.(next)
  }
  return (
    <ModalDialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={t('images.preview')}
      description={parameters}
      wide
      {...(returnFocus ? { returnFocus } : {})}
    >
      {file ? (
        <div
          onKeyDown={(event) => {
            if (
              event.target instanceof HTMLSelectElement ||
              event.target instanceof HTMLInputElement
            )
              return
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              move(event.key === 'ArrowLeft' ? -1 : 1)
            }
          }}
        >
          <div className="relative rounded-xl bg-muted">
            <div className="max-h-[52dvh] overflow-auto rounded-xl">
              <div style={{ width: zoom + '%' }} className="mx-auto">
                <ProtectedImage
                  file={file}
                  original
                  alt={prompt || t('images.preview')}
                  className="h-auto w-full"
                />
              </div>
            </div>
            {files.length > 1 ? (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="absolute top-1/2 left-2 rounded-full"
                  aria-label={t('images.previous')}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={18} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="absolute top-1/2 right-2 rounded-full"
                  aria-label={t('images.next')}
                  onClick={() => move(1)}
                >
                  <ChevronRight size={18} />
                </Button>
              </>
            ) : null}
          </div>
          <p className="my-4 whitespace-pre-wrap break-words text-sm leading-6">{prompt}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              {t('images.zoom')}
              <select
                className="rounded-lg border border-border bg-background p-2"
                aria-label={t('images.zoom')}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                {[50, 100, 150, 200].map((value) => (
                  <option key={value} value={value}>
                    {value}%
                  </option>
                ))}
              </select>
            </label>
            <span className="text-muted-foreground">
              {t('images.originalSize', { width: file.width, height: file.height })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void actions.download(file)
              }}
            >
              <Download size={14} />
              {t('images.download')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void actions.copy(file)
              }}
            >
              <Copy size={14} />
              {t(actions.copied ? 'images.copied' : 'images.copy')}
            </Button>
            {onEdit ? (
              <Button
                size="sm"
                onClick={() => {
                  onClose()
                  onEdit(file)
                }}
              >
                <Plus size={14} />
                {t('images.edit')}
              </Button>
            ) : null}
          </div>
          <ApiNotice error={actions.error} />
        </div>
      ) : null}
    </ModalDialog>
  )
}
