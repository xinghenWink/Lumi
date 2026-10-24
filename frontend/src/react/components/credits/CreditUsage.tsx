import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { credits } from '../../../api/credits'
import { useSession } from '../../features/auth/hooks'
import { Panel } from '../shared/Panel'
import { ApiNotice } from '../shared/ApiNotice'
import { Button } from '../ui/button'
export function CreditUsage() {
  const { user } = useSession(),
    { t, i18n } = useTranslation()
  const query = useQuery({
    queryKey: ['user', user?.id, 'credit-usage'],
    enabled: !!user,
    queryFn: ({ signal }) => credits.usage(signal),
  })
  const maximum = Math.max(1, ...(query.data?.days.map((day) => day.consumed) ?? []))
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value)
  return (
    <Panel title={t('credits.usage')} className="credit-usage">
      <ApiNotice error={query.error} />
      {query.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : query.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('common.retry')}
        </Button>
      ) : query.data ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-muted-foreground">{t('credits.monthConsumed')}</span>
              <strong className="mt-2 block text-3xl font-semibold">
                {number(query.data.month_consumed)}
              </strong>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">{t('credits.successfulImages')}</span>
              <div className="mt-3 flex flex-wrap gap-3">
                {(['low', 'medium', 'high'] as const).map((quality) => (
                  <span key={quality} className="text-[10px] text-muted-foreground">
                    {t('credits.' + quality)}
                    <strong className="ml-1.5 text-sm text-foreground">
                      {number(query.data?.images_by_quality[quality] ?? 0)}
                    </strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <figure className="mt-7">
            <figcaption className="text-xs text-muted-foreground">{t('credits.days30')}</figcaption>
            <ol className="mt-4 flex h-24 items-end gap-1" aria-label={t('credits.chartLabel')}>
              {query.data.days.map((day) => (
                <li
                  key={day.date}
                  className="flex h-full min-w-0 flex-1 items-end"
                  title={t('credits.chartDay', { date: day.date, amount: day.consumed })}
                  aria-label={t('credits.chartDay', { date: day.date, amount: day.consumed })}
                >
                  <span
                    className={
                      'w-full rounded-t-sm ' +
                      (day.consumed ? 'bg-primary/70' : 'min-h-px bg-border')
                    }
                    style={{ height: (day.consumed / maximum) * 100 + '%' }}
                  />
                </li>
              ))}
            </ol>
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>{query.data.days[0]?.date}</span>
              <span>{query.data.days.at(-1)?.date}</span>
            </div>
          </figure>
          {!query.data.days.some((day) => day.consumed > 0) ? (
            <p className="mt-4 text-xs text-muted-foreground">{t('credits.noUsage')}</p>
          ) : null}
          <p className="mt-4 text-[10px] leading-5 text-muted-foreground">
            {t('credits.usageHint')} {t('credits.timezone', { zone: query.data.timezone })}
          </p>
        </>
      ) : null}
    </Panel>
  )
}
