import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'
import accountsZH from './accounts.zh-CN'
import accountsEN from './accounts.en'
import creditsZH from './credits.zh-CN'
import creditsEN from './credits.en'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: {
    'zh-CN': {
      ...zhCN,
      ...accountsZH,
      ...creditsZH,
      nav: { ...accountsZH.nav, ...creditsZH.nav },
      errors: { ...accountsZH.errors, ...creditsZH.errors },
    },
    en: {
      ...en,
      ...accountsEN,
      ...creditsEN,
      nav: { ...accountsEN.nav, ...creditsEN.nav },
      errors: { ...accountsEN.errors, ...creditsEN.errors },
    },
  },
})
