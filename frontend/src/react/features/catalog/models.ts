import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useQuery } from '@tanstack/react-query'
import { catalog } from '../../../api/catalog'
import { ApiError } from '../../../api/transport'
import type { ModelKind } from '../../../api/catalog-contracts'
import { useRuntime } from '../../app/context'
import { useSession } from '../auth/hooks'

interface ModelSelection {
  selected: Record<ModelKind, string>
  select(kind: ModelKind, id: string): void
  reset(): void
}
export function createModelSelectionStore() {
  return createStore<ModelSelection>()((set) => ({
    selected: { chat: '', image: '' },
    select: (kind, id) => set((state) => ({ selected: { ...state.selected, [kind]: id } })),
    reset: () => set({ selected: { chat: '', image: '' } }),
  }))
}
export function useModels(kind: ModelKind) {
  const runtime = useRuntime()
  const { user } = useSession()
  const preferred = useStore(runtime.modelStore, (state) => state.selected[kind])
  const query = useQuery({
    queryKey: ['user', user?.id, 'models', kind],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      const data = await catalog.public(kind, signal)
      if (data.items.some((model) => model.type !== kind)) throw new ApiError('RESPONSE_INVALID')
      return data
    },
  })
  const items = query.data?.items ?? []
  const selected =
    items.find((model) => model.id === preferred) ??
    items.find((model) => model.is_default) ??
    items[0]
  return {
    query,
    items,
    selected,
    select: (id: string) => {
      if (items.some((model) => model.id === id)) runtime.modelStore.getState().select(kind, id)
    },
  }
}
