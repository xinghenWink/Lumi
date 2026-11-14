import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { i18n } from 'i18next'
import { catalog } from './catalog'
import publicModels from '../../i18n/catalog-shell.zh-CN'

const routes = {
  admin: {
    key: 'admin.console',
    async load() {
      const [accounts, models] = await Promise.all([
        import('../../i18n/accounts-admin.zh-CN'),
        import('../../i18n/catalog-admin.zh-CN'),
      ])
      return {
        default: {
          ...accounts.default,
          catalog: { ...publicModels.catalog, ...models.default.catalog },
        },
      }
    },
  },
  legal: { key: 'legal.termsTitle', load: () => import('../../i18n/legal.zh-CN') },
} as const

export async function loadRouteCopy(language: i18n, scope: keyof typeof routes) {
  const { key, load } = routes[scope]
  if (language.exists(key, { lng: 'zh-CN' })) return
  const { default: messages } = await load()
  language.addResourceBundle('zh-CN', 'translation', catalog(messages))
}

export function useRouteCopy(scope: keyof typeof routes) {
  const { i18n } = useTranslation()
  const [error, setError] = useState<unknown>()
  const [attempt, setAttempt] = useState(0)
  const ready = i18n.exists(routes[scope].key)
  useEffect(() => {
    let active = true
    if (!ready)
      void loadRouteCopy(i18n, scope).catch((failure: unknown) => {
        if (active) setError(failure)
      })
    return () => {
      active = false
    }
  }, [attempt, i18n, ready, scope])
  return {
    ready,
    error,
    retry() {
      setError(undefined)
      setAttempt((current) => current + 1)
    },
  }
}
