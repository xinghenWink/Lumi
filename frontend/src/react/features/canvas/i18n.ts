import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { i18n as I18n } from 'i18next'

const catalogs = {
  'zh-CN': () => import('../../../i18n/canvas.zh-CN'),
  en: () => import('../../../i18n/canvas.en'),
} as const

const language = (code: string | undefined): keyof typeof catalogs =>
  code === 'en' ? 'en' : 'zh-CN'

/**
 * Adds the canvas copy to an i18n instance; repeated calls are cheap. The bundle is
 * rebuilt rather than deep-merged because a deep merge writes into the shell catalog
 * objects that i18next keeps by reference.
 */
export async function loadCanvasCatalog(i18n: I18n, code: string | undefined) {
  const lng = language(code)
  if (i18n.exists('canvas.list.heading', { lng })) return
  const { default: catalog } = await catalogs[lng]()
  const current: unknown = i18n.getResourceBundle(lng, 'translation')
  const errors =
    typeof current === 'object' && current !== null && 'errors' in current
      ? current.errors
      : undefined
  i18n.addResourceBundle(
    lng,
    'translation',
    {
      canvas: catalog.canvas,
      errors: { ...(typeof errors === 'object' ? errors : {}), ...catalog.errors },
    },
    false,
    true,
  )
}

/**
 * Loads the canvas catalog for the active language and again after every language
 * switch. Returns false until the first load finishes so pages can show a loader.
 */
export function useCanvasCatalog() {
  const { i18n } = useTranslation()
  const [loaded, setLoaded] = useState(() =>
    i18n.exists('canvas.list.heading', { lng: language(i18n.resolvedLanguage) }),
  )
  const [, setLanguage] = useState('')
  useEffect(() => {
    let active = true
    const load = (code: string) => {
      loadCanvasCatalog(i18n, code).then(
        () => {
          if (!active) return
          setLoaded(true)
          setLanguage(code)
        },
        () => {
          if (active) setLoaded(true)
        },
      )
    }
    load(i18n.resolvedLanguage ?? 'zh-CN')
    i18n.on('languageChanged', load)
    return () => {
      active = false
      i18n.off('languageChanged', load)
    }
  }, [i18n])
  return loaded
}
