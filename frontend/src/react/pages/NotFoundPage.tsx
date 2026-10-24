import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('notFound.description')}</p>
      <Link to="/" className="rounded-xl bg-primary px-5 py-2.5 text-sm text-primary-foreground">
        {t('notFound.home')}
      </Link>
    </section>
  )
}
