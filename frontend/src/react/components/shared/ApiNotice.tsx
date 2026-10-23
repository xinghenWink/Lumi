import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../../api/transport'

export function ApiNotice({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation()
  if (!error) return null
  const api = error instanceof ApiError ? error : undefined
  const key =
    api && i18n.exists(`errors.${api.code}`) ? `errors.${api.code}` : 'errors.UNKNOWN_ERROR'
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        {t(key)}
        {api?.retryAfter ? (
          <p className="mt-1 text-xs">{t('credits.retryAfter', { seconds: api.retryAfter })}</p>
        ) : null}
        {api?.requestId ? (
          <p className="mt-1 break-all text-xs">
            {t('common.requestId')} {api.requestId}
          </p>
        ) : null}
      </div>
    </div>
  )
}
