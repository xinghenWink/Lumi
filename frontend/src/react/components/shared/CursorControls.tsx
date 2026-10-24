import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
export function CursorControls({
  page,
  nextCursor,
  loading,
  onPrevious,
  onNext,
}: {
  page: number
  nextCursor: string
  loading: boolean
  onPrevious(): void
  onNext(): void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span>{t('common.page', { page })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 1 || loading} onClick={onPrevious}>
          <ChevronLeft size={14} />
          {t('common.previous')}
        </Button>
        <Button variant="outline" size="sm" disabled={!nextCursor || loading} onClick={onNext}>
          {t('common.next')}
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}
