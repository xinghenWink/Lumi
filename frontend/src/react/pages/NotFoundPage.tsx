import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <p aria-hidden="true" className="text-6xl font-semibold tracking-tight text-input">
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('notFound.description')}</p>
      <Link
        to="/"
        className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
      >
        {t('notFound.home')}
      </Link>
    </section>
  )
}
