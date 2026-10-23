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
        <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
    </div>
  )
}
