import { createI18n } from 'vue-i18n'
import { messages } from './resources'

export const i18n = createI18n({ legacy: false, locale: 'zh-CN', fallbackLocale: 'en', messages })
