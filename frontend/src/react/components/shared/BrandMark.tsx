import { useTranslation } from 'react-i18next'
import { usePublicConfig } from '../../features/auth/hooks'
import { cn } from '../../lib/utils'
import mark from '../../assets/brand/lumi-mark.webp'
import wordmark from '../../assets/brand/lumi-wordmark.webp'
import wordmarkDark from '../../assets/brand/lumi-wordmark-dark.webp'

/** The bundled wordmark spells the product name; a renamed site shows its name as text. */
const product = 'lumi'

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const config = usePublicConfig()
  const name = config.data?.site.name || t('app.name')
  const logo = config.data?.site.logo_url
  const lettered = !logo && name.trim().toLowerCase() === product
  return (
    <span className={cn('flex min-w-0 items-center', lettered ? 'gap-1.5' : 'gap-2.5')}>
      {logo ? (
        <img src={logo} alt="" className="size-8 rounded-lg object-contain" />
      ) : (
        <img src={mark} alt="" width={128} height={128} className="size-8 shrink-0" />
      )}
      {compact ? null : lettered ? (
        <>
          <img
            src={wordmark}
            alt={name}
            width={256}
            height={96}
            className="h-[22px] w-auto dark:hidden"
          />
          {/* Lazy, so light-theme visitors never fetch the hidden dark variant. */}
          <img
            src={wordmarkDark}
            alt={name}
            width={256}
            height={96}
            loading="lazy"
            className="hidden h-[22px] w-auto dark:block"
          />
        </>
      ) : (
        <span className="truncate text-[17px] font-semibold tracking-tight">{name}</span>
      )}
    </span>
  )
}
