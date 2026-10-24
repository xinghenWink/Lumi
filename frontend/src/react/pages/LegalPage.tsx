import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePublicConfig } from '../features/auth/hooks'

export default function LegalPage() {
  const { t } = useTranslation()
  const privacy = useLocation().pathname === '/privacy'
  const config = usePublicConfig()
  const sections = privacy ? ['data', 'purpose', 'contact'] : ['service', 'account', 'content']
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-5 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t(privacy ? 'legal.privacyTitle' : 'legal.termsTitle')}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{t('legal.updated')}</p>
      </div>
      {sections.map((section) => (
        <section key={section}>
          <h2 className="mb-3 text-lg font-semibold">{t(`legal.${section}Title`)}</h2>
          <p className="whitespace-pre-line text-sm leading-8 text-muted-foreground">
            {t(`legal.${section}`)}
          </p>
          {section === 'contact' && config.data?.site.contact ? (
            <p className="mt-3 break-words text-sm">{config.data.site.contact}</p>
          ) : null}
        </section>
      ))}
      <Link to="/login" className="text-sm text-primary">
        {t('common.back')}
      </Link>
    </article>
  )
}
