import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '../auth/hooks'

export function useTime() {
  const { i18n, t } = useTranslation()
  const { user } = useSession()
  const timezone = user?.timezone ?? 'Asia/Shanghai'
  return useCallback(
    (value: string | null) => {
      if (!value) return t('common.none')
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return t('common.none')
      try {
        return new Intl.DateTimeFormat(i18n.resolvedLanguage, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: timezone,
        }).format(date)
      } catch {
        return date.toISOString()
      }
    },
    [i18n.resolvedLanguage, t, timezone],
  )
}
