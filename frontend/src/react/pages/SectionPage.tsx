import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { routeTitle } from '../features/accounts/navigation'

// Route scaffolds retain navigation while their complete modules land in later milestones.
export default function SectionPage() {
  const { t } = useTranslation()
  const location = useLocation()
  return (
    <section className="mx-auto w-full max-w-6xl p-5 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t(routeTitle(location.pathname))}</h1>
    </section>
  )
}
