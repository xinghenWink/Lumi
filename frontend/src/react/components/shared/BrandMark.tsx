import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePublicConfig } from '../../features/auth/hooks'

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const config = usePublicConfig()
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {config.data?.site.logo_url ? (
        <img src={config.data.site.logo_url} alt="" className="size-9 rounded-xl object-contain" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles size={20} strokeWidth={1.7} />
        </span>
      )}
      {!compact ? (
        <span className="truncate text-xl font-semibold tracking-tight">
          {config.data?.site.name || t('app.name')}
        </span>
      ) : null}
    </span>
  )
}
