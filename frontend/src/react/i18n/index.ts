import { createInstance, type BackendModule } from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './zh-CN'

/**
 * zh-CN is the primary locale and ships in the entry chunk; English is fetched only
 * when selected, which keeps the authenticated first-load script within budget.
 */
const lazyCatalogs: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    if (language !== 'en') {
      callback(null, {})
      return
    }
    import('./en')
      .then((module) => callback(null, module.default))
      .catch((error: unknown) => callback(error instanceof Error ? error : String(error), null))
  },
}

export async function createAppI18n(locale: 'zh-CN' | 'en' = 'zh-CN') {
  const language = createInstance()
  await language
    .use(lazyCatalogs)
    .use(initReactI18next)
    .init({
      lng: locale,
      // Both catalogs share every key (see index.test.ts), so no cross-locale fallback is needed.
      fallbackLng: false,
      supportedLngs: ['zh-CN', 'en'],
      partialBundledLanguages: true,
      resources: { 'zh-CN': { translation: zhCN } },
      // Preserve existing message placeholders without duplicating both language catalogs.
      interpolation: { prefix: '{', suffix: '}', escapeValue: false },
      react: { useSuspense: false, bindI18nStore: 'added' },
    })
  return language
}
