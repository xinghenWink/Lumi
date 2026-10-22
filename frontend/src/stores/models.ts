import { defineStore } from 'pinia'
import { reactive, shallowReactive, watch } from 'vue'
import { catalog } from '../api/catalog'
import { ApiError } from '../api/transport'
import type { ModelKind, PublicModel } from '../api/catalog-contracts'
import { useAuthStore } from './auth'
export const useModelStore = defineStore('models', () => {
  const auth = useAuthStore()
  const items = shallowReactive<Record<ModelKind, PublicModel[]>>({ chat: [], image: [] })
  const selected = reactive<Record<ModelKind, string>>({ chat: '', image: '' })
  const loading = reactive<Record<ModelKind, boolean>>({ chat: false, image: false })
  const errors = shallowReactive<Record<ModelKind, unknown>>({ chat: null, image: null })
  const controllers: Partial<Record<ModelKind, AbortController>> = {}
  const generations: Record<ModelKind, number> = { chat: 0, image: 0 }
  function cancel(kind: ModelKind) {
    generations[kind]++
    controllers[kind]?.abort()
    loading[kind] = false
  }
  function reset() {
    for (const kind of ['chat', 'image'] as const) {
      cancel(kind)
      items[kind] = []
      selected[kind] = ''
      errors[kind] = null
    }
  }
  watch(() => auth.user?.id, reset, { flush: 'sync' })
  async function load(kind: ModelKind) {
    cancel(kind)
    const current = generations[kind]
    const controller = new AbortController()
    controllers[kind] = controller
    loading[kind] = true
    errors[kind] = null
    try {
      const result = await catalog.public(kind, controller.signal)
      if (current !== generations[kind]) return
      if (result.items.some((item) => item.type !== kind)) throw new ApiError('RESPONSE_INVALID')
      items[kind] = result.items
      if (!items[kind].some((item) => item.id === selected[kind]))
        selected[kind] = items[kind].find((item) => item.is_default)?.id ?? items[kind][0]?.id ?? ''
    } catch (failure) {
      if (
        current === generations[kind] &&
        !(failure instanceof DOMException && failure.name === 'AbortError')
      ) {
        items[kind] = []
        selected[kind] = ''
        errors[kind] = failure
      }
    } finally {
      if (current === generations[kind]) loading[kind] = false
    }
  }
  function select(kind: ModelKind, id: string) {
    if (items[kind].some((item) => item.id === id)) selected[kind] = id
  }
  return { items, selected, loading, errors, load, select, cancel, reset }
})
