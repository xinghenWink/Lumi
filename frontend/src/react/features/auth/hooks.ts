import { useEffect } from 'react'
import { useStore } from 'zustand'
import { useQuery } from '@tanstack/react-query'
import { useRuntime } from '../../app/context'
import { request } from '../../../api/transport'
import { parsePublic } from '../../../api/contracts'

export function useSession() {
  const runtime = useRuntime()
  const state = useStore(runtime.sessionStore)
  useEffect(() => {
    void runtime.session.bootstrap()
  }, [runtime])
  return state
}

export function usePublicConfig() {
  const query = useQuery({
    queryKey: ['public', 'config'],
    queryFn: ({ signal }) => request('/api/v1/public/config', parsePublic, { signal }),
    refetchInterval: 30_000,
  })
  useEffect(() => {
    const favicon = query.data?.site.favicon_url
    if (favicon?.startsWith('/') && !favicon.startsWith('//')) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (link) link.href = favicon
    }
  }, [query.data?.site.favicon_url])
  return query
}
