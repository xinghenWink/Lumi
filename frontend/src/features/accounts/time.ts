import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../../stores/auth'

export function useTime() {
  const { locale, t } = useI18n()
  const auth = useAuthStore()
  return (value: string | null) => {
    if (!value) return t('common.none')
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return t('common.none')
    try {
      return new Intl.DateTimeFormat(locale.value, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: auth.user?.timezone ?? 'Asia/Shanghai',
      }).format(date)
    } catch {
      return date.toISOString()
    }
  }
}
