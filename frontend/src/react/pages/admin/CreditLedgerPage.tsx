import { useTranslation } from 'react-i18next'
import { AdminPage } from '../../components/admin/AdminPage'
import { CreditLedger } from '../../components/credits/CreditLedger'
export default function CreditLedgerPage() {
  const { t } = useTranslation()
  return (
    <AdminPage title={t('credits.ledger')}>
      <CreditLedger admin />
    </AdminPage>
  )
}
