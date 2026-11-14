import { useTranslation } from 'react-i18next'
import { ApiNotice } from './ApiNotice'
import { Skeleton } from '../ui/skeleton'
import { Button } from '../ui/button'

export function PageStatus({ error, retry }: { error?: unknown; retry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6"
      role={error ? undefined : 'status'}
    >
      {error ? (
        <>
          <ApiNotice error={error} />
          {retry ? (
            <Button type="button" variant="outline" onClick={retry}>
              {t('common.retry')}
            </Button>
          ) : null}
        </>
      ) : (
        <p className="flex items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Skeleton aria-hidden="true" className="size-4 rounded-full bg-primary/25" />
          {t('common.loading')}
        </p>
      )}
    </div>
  )
}
