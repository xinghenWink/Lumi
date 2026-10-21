import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'
import accountsZH from './accounts.zh-CN'
import accountsEN from './accounts.en'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': { ...zhCN, ...accountsZH }, en: { ...en, ...accountsEN } },
})
