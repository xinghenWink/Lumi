import { Sparkles } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function WorkspaceHome() {
  const { t } = useTranslation()
  const image = useLocation().pathname.startsWith('/create')
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent text-primary">
        <Sparkles size={28} strokeWidth={1.6} />
      </span>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t(image ? 'images.title' : 'react.title')}
      </h1>
      <p className="max-w-md text-sm leading-7 text-muted-foreground">
        {t(image ? 'images.description' : 'react.description')}
      </p>
    </section>
  )
}
