import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePublicConfig } from '../../features/auth/hooks'

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const config = usePublicConfig()
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {config.data?.site.logo_url ? (
        <img src={config.data.site.logo_url} alt="" className="size-8 rounded-lg object-contain" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-xs">
          <Sparkles size={17} strokeWidth={1.8} />
        </span>
      )}
      {!compact ? (
        <span className="truncate text-[17px] font-semibold tracking-tight">
          {config.data?.site.name || t('app.name')}
        </span>
      ) : null}
    </span>
  )
}
