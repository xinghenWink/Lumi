import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { messages } from '../../i18n/resources'

// Vue's literal escapes are data syntax, not part of the translated text.
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\{'([^']*)'\}/g, '$1')
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
  return value
}

function catalog(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
}

export async function createAppI18n(locale: 'zh-CN' | 'en' = 'zh-CN') {
  const language = createInstance()
  await language.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: ['zh-CN', 'en'],
    resources: {
      'zh-CN': {
        translation: {
          ...catalog(messages['zh-CN']),
          react: {
            title: '今天想创造什么？',
            description: '让想法自由生长，Lumi 陪你一起探索。',
            changeLanguage: '切换语言',
            languageLabel: 'EN',
            switchLight: '切换浅色主题',
            switchDark: '切换深色主题',
            version: 'Lumi · {version}',
            adminOverview: '工作台',
            adminUsers: '用户与财务',
            adminAI: 'AI 服务',
            adminOperations: '运营与安全',
            recentChats: '最近对话',
            newCreation: '开启新创作',
            visionRequired: '请切换到支持图片的聊天模型，或移除参考图后发送。',
          },
        },
      },
      en: {
        translation: {
          ...catalog(messages.en),
          react: {
            title: 'What would you like to create today?',
            description: 'Give your ideas room to grow. Explore and create with Lumi.',
            changeLanguage: 'Change language',
            languageLabel: '中文',
            switchLight: 'Switch to light theme',
            switchDark: 'Switch to dark theme',
            version: 'Lumi · {version}',
            adminOverview: 'Overview',
            adminUsers: 'Users & finance',
            adminAI: 'AI services',
            adminOperations: 'Operations & security',
            recentChats: 'Recent conversations',
            newCreation: 'New creation',
            visionRequired:
              'Choose a vision-enabled chat model or remove the references before sending.',
          },
        },
      },
    },
    // Preserve existing message placeholders without duplicating both language catalogs.
    interpolation: { prefix: '{', suffix: '}', escapeValue: false },
    react: { useSuspense: false },
  })
  return language
}
