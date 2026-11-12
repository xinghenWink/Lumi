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
      className="group mb-2 flex min-h-14 items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 shadow-xs transition-colors hover:border-input"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
        <Coins size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-xs font-semibold tabular-nums">
          {query.data
            ? new Intl.NumberFormat(i18n.resolvedLanguage).format(query.data.total)
            : t(query.isError ? 'common.retry' : 'common.loading')}{' '}
          <span className="font-normal text-muted-foreground">{t('credits.unit')}</span>
        </strong>
        {query.data ? (
          <span className="block truncate text-2xs text-muted-foreground tabular-nums">
            {t('credits.split', {
              daily: query.data.daily_balance,
              permanent: query.data.permanent_balance,
            })}
          </span>
        ) : null}
      </span>
      <ChevronRight
        size={14}
        className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  )
}
