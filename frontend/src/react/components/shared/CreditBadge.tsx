import { useQuery } from '@tanstack/react-query'
import { Coins, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import { useSession } from '../../features/auth/hooks'

export function CreditBadge({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t, i18n } = useTranslation()
  const { user } = useSession()
  const query = useQuery({
    queryKey: ['user', user?.id, 'credits'],
    enabled: !!user,
    queryFn: ({ signal }) => credits.account(undefined, signal),
    staleTime: 0,
    refetchInterval: 30_000,
  })
  return (
    <Link
      to="/me/credits"
      onClick={onNavigate}
      className="mb-3 flex min-h-16 items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <Coins size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-xs font-semibold">
          {query.data
            ? new Intl.NumberFormat(i18n.resolvedLanguage).format(query.data.total)
            : t(query.isError ? 'common.retry' : 'common.loading')}{' '}
          <span className="font-normal text-muted-foreground">{t('credits.unit')}</span>
        </strong>
        {query.data ? (
          <span className="block truncate text-[10px] text-muted-foreground">
            {t('credits.split', {
              daily: query.data.daily_balance,
              permanent: query.data.permanent_balance,
            })}
          </span>
        ) : null}
      </span>
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
    </Link>
  )
}
