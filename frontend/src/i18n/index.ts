import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'
import accountsZH from './accounts.zh-CN'
import accountsEN from './accounts.en'
import creditsZH from './credits.zh-CN'
import creditsEN from './credits.en'
import catalogZH from './catalog.zh-CN'
import catalogEN from './catalog.en'
import chatZH from './chat.zh-CN'
import chatEN from './chat.en'
import imagesZH from './images.zh-CN'
import imagesEN from './images.en'
import operationsZH from './operations.zh-CN'
import operationsEN from './operations.en'

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
      ...chatZH,
      ...imagesZH,
      ...operationsZH,
      nav: {
        ...accountsZH.nav,
        ...creditsZH.nav,
        ...catalogZH.nav,
        ...chatZH.nav,
        ...imagesZH.nav,
        ...operationsZH.nav,
      },
      errors: {
        ...accountsZH.errors,
        ...creditsZH.errors,
        ...catalogZH.errors,
        ...chatZH.errors,
        ...imagesZH.errors,
        ...operationsZH.errors,
      },
    },
    en: {
      ...en,
      ...accountsEN,
      ...creditsEN,
      ...catalogEN,
      ...chatEN,
      ...imagesEN,
      ...operationsEN,
      nav: {
        ...accountsEN.nav,
        ...creditsEN.nav,
        ...catalogEN.nav,
        ...chatEN.nav,
        ...imagesEN.nav,
        ...operationsEN.nav,
      },
      errors: {
        ...accountsEN.errors,
        ...creditsEN.errors,
        ...catalogEN.errors,
        ...chatEN.errors,
        ...imagesEN.errors,
        ...operationsEN.errors,
      },
    },
  },
})
