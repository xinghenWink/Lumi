import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'
import accountsZH from './accounts.zh-CN'
import accountsEN from './accounts.en'
import creditsZH from './credits.zh-CN'
import creditsEN from './credits.en'
import catalogZH from './catalog.zh-CN'
import catalogEN from './catalog.en'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: {
    'zh-CN': {
      ...zhCN,
      ...accountsZH,
      ...creditsZH,
      ...catalogZH,
      nav: { ...accountsZH.nav, ...creditsZH.nav, ...catalogZH.nav },
      errors: { ...accountsZH.errors, ...creditsZH.errors, ...catalogZH.errors },
    },
    en: {
      ...en,
      ...accountsEN,
      ...creditsEN,
      ...catalogEN,
      nav: { ...accountsEN.nav, ...creditsEN.nav, ...catalogEN.nav },
      errors: { ...accountsEN.errors, ...creditsEN.errors, ...catalogEN.errors },
    },
  },
})
