import { useTranslation } from 'react-i18next'
import { ApiNotice } from './ApiNotice'
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
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-input border-t-primary"
          />
          {t('common.loading')}
        </p>
      )}
    </div>
  )
}
