import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { canvases, type Canvas, type CanvasPage, type CanvasSummary } from '../../../api/canvases'
import { useSession } from '../auth/hooks'

export const canvasListKey = (user: string | undefined) => ['user', user, 'canvases'] as const

/** Mirrors a saved canvas into cached list rows so titles stay current without refetching. */
export function patchCanvasList(client: QueryClient, user: string | undefined, saved: Canvas) {
  client.setQueriesData<InfiniteData<CanvasPage>>({ queryKey: canvasListKey(user) }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) =>
              row.id === saved.id
                ? {
                    ...row,
                    title: saved.title,
                    node_count: saved.node_count,
                    version: saved.version,
                    updated_at: saved.updated_at,
                  }
                : row,
            ),
          })),
        }
      : data,
  )
}

export function useCanvasList(search = '', limit = 24, enabled = true) {
  const { user } = useSession()
  return useInfiniteQuery({
    queryKey: [...canvasListKey(user?.id), search, limit],
    enabled: !!user && enabled,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      canvases.list(
        new URLSearchParams({ search, limit: String(limit), cursor: pageParam }),
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor || undefined,
  })
}

/** Rename keeps the stored document; it reloads the latest version and saves only the title. */
export function useCanvasMutations() {
  const client = useQueryClient()
  const { user } = useSession()
  const refresh = () => client.invalidateQueries({ queryKey: canvasListKey(user?.id) })
  const create = useMutation({
    mutationFn: (title: string) => canvases.create(crypto.randomUUID(), title),
    onSuccess: refresh,
  })
  const rename = useMutation({
    mutationFn: async ({ row, title }: { row: CanvasSummary; title: string }) => {
      const latest = await canvases.get(row.id)
      return canvases.save(row.id, { title, document: latest.document, version: latest.version })
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => canvases.remove(id),
    onSuccess: refresh,
  })
  return { create, rename, remove, refresh }
}
