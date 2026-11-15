import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageFile } from '../../../api/images'
import { Button } from '../ui/button'

const ImagePreview = lazy(() =>
  import('./ImagePreview').then((module) => ({ default: module.ImagePreview })),
)

export function ReferencePreviewButton({
  file,
  position,
  children,
}: {
  file: ImageFile
  position: number
  children: ReactNode
}) {
  const { t } = useTranslation()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const label = t('images.previewReference', { index: position })

  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        className="size-full cursor-zoom-in overflow-hidden rounded-none p-0 focus-visible:-outline-offset-2"
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      {open ? (
        <Suspense fallback={null}>
          <ImagePreview
            files={[file]}
            prompt=""
            parameters={t('images.references')}
            onClose={() => setOpen(false)}
            returnFocus={trigger}
          />
        </Suspense>
      ) : null}
    </>
  )
}
