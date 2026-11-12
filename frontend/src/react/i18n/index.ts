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
            imageParameters: '生图参数',
            imageCount: '{count} 张',
            dropTitle: '松开以添加图片',
            dropHint: 'PNG、JPEG、WebP，单张不超过 {size} MB，还可添加 {count} 张',
            dropFull: '参考图已满（最多 {max} 张）',
            dropVisionRequired: '当前聊天模型不支持图片，请切换到支持视觉的模型',
            dropLocked: '正在提交，请稍后再添加图片',
            dropzoneHint: '拖入、粘贴或点击上传',
            referenceSlots: '{count}/{max}',
            referenceSlotsLabel: '已添加 {count} 张参考图，最多 {max} 张',
            uploading: '正在上传',
            uploadFailed: '上传失败',
            retryUpload: '重试上传',
            cancelUpload: '取消上传',
            filesRejectedType: '已跳过 {count} 个文件：仅支持 PNG、JPEG、WebP',
            filesRejectedSize: '已跳过 {count} 个文件：单张超过 {size} MB',
            filesRejectedLimit: '已跳过 {count} 个文件：超出参考图数量上限',
            suggestions: '试试这样开始',
            chatSuggestions: {
              explain: '用简单的话解释量子纠缠',
              write: '帮我写一封得体的请假邮件',
              plan: '规划一个周末两天的杭州行程',
              code: '用 TypeScript 写一个防抖函数',
            },
            imageSuggestions: {
              landscape: '黄昏时分的海边灯塔，暖色调，电影感光影',
              product: '浅色背景上的陶瓷咖啡杯，产品摄影，柔和侧光',
              portrait: '窗边看书的少女，水彩插画风格，自然光',
              illustration: '雨夜霓虹街道上的橘猫，赛博朋克插画',
            },
            imageEmptyHint: '在左侧描述你想要的画面，生成结果会出现在这里。',
            newResults: '有新的结果',
            submitting: '正在提交…',
            elapsed: '已用 {seconds} 秒',
            previewPosition: '{index} / {total}',
            promptHint: 'Enter 生成 · Shift + Enter 换行',
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
            imageParameters: 'Image parameters',
            imageCount: '{count} images',
            dropTitle: 'Drop to add images',
            dropHint: 'PNG, JPEG or WebP up to {size} MB each · {count} more allowed',
            dropFull: 'Reference limit reached ({max})',
            dropVisionRequired: "This chat model can't read images. Choose a vision model.",
            dropLocked: 'Submitting — add images afterwards',
            dropzoneHint: 'Drag, paste or click to upload',
            referenceSlots: '{count}/{max}',
            referenceSlotsLabel: '{count} of {max} reference images',
            uploading: 'Uploading',
            uploadFailed: 'Upload failed',
            retryUpload: 'Retry upload',
            cancelUpload: 'Cancel upload',
            filesRejectedType: 'Skipped {count} file(s): only PNG, JPEG and WebP are supported',
            filesRejectedSize: 'Skipped {count} file(s): larger than {size} MB',
            filesRejectedLimit: 'Skipped {count} file(s): over the reference limit',
            suggestions: 'Try one of these',
            chatSuggestions: {
              explain: 'Explain quantum entanglement in simple terms',
              write: 'Draft a polite leave request email',
              plan: 'Plan a two-day weekend trip to Hangzhou',
              code: 'Write a debounce function in TypeScript',
            },
            imageSuggestions: {
              landscape: 'A seaside lighthouse at dusk, warm tones, cinematic light',
              product: 'A ceramic coffee cup on a light backdrop, product photo, soft side light',
              portrait: 'A girl reading by the window, watercolor illustration, natural light',
              illustration: 'An orange cat on a neon street in the rain, cyberpunk illustration',
            },
            imageEmptyHint: 'Describe the image you want on the left; results will appear here.',
            newResults: 'New results',
            submitting: 'Submitting…',
            elapsed: '{seconds}s elapsed',
            previewPosition: '{index} / {total}',
            promptHint: 'Enter to generate · Shift + Enter for a new line',
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
