import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditOverview } from '../components/credits/CreditOverview'
import { CreditUsage } from '../components/credits/CreditUsage'
import { CreditLedger } from '../components/credits/CreditLedger'
import { RedemptionRecords } from '../components/credits/RedemptionRecords'
import { Button } from '../components/ui/button'
export default function CreditsPage() {
  const { t } = useTranslation(),
    [tab, setTab] = useState('ledger')
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t('credits.title')}</h1>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">{t('credits.description')}</p>
        </header>
        <div className="mb-7 grid gap-5 xl:grid-cols-2">
          <CreditOverview />
          <CreditUsage />
        </div>
        <nav aria-label={t('credits.title')} className="mb-5 flex gap-2">
          {['ledger', 'records'].map((value) => (
            <Button
              key={value}
              variant={tab === value ? 'default' : 'outline'}
              size="sm"
              aria-current={tab === value ? 'page' : undefined}
              onClick={() => setTab(value)}
            >
              {t('credits.' + value)}
            </Button>
          ))}
        </nav>
        {tab === 'ledger' ? <CreditLedger /> : <RedemptionRecords />}
      </div>
    </div>
  )
}
