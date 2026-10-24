import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

export function createMutationKey() {
  let payload = '',
    key = ''
  return {
    forPayload(value: unknown) {
      const next = JSON.stringify(value)
      if (next !== payload || !key) {
        payload = next
        key = crypto.randomUUID()
      }
      return key
    },
    complete() {
      payload = ''
      key = ''
    },
  }
}
export function useCursorQuery<T extends { next_cursor: string }>(
  key: readonly unknown[],
  fetchPage: (cursor: string, signal: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const scope = JSON.stringify(key)
  const [paging, setPaging] = useState({ scope, cursors: [''] })
  const cursors = paging.scope === scope ? paging.cursors : ['']
  const cursor = cursors.at(-1) ?? ''
  const query = useQuery({
    queryKey: [...key, cursor],
    enabled,
    queryFn: ({ signal }) => fetchPage(cursor, signal),
  })
  return {
    ...query,
    page: cursors.length,
    reset: () => setPaging({ scope, cursors: [''] }),
    next: () => {
      if (!query.isFetching && query.data?.next_cursor)
        setPaging({ scope, cursors: [...cursors, query.data.next_cursor] })
    },
    previous: () => {
      if (!query.isFetching && cursors.length > 1)
        setPaging({ scope, cursors: cursors.slice(0, -1) })
    },
  }
}
