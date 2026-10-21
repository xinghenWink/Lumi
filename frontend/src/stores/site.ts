import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { parsePublic, type PublicConfig } from '../api/contracts'
import { request } from '../api/transport'

export const useSiteStore = defineStore('site', () => {
  const config = shallowRef<PublicConfig | null>(null)
  const loading = ref(false)
  const error = shallowRef<unknown>(null)
  let pending: Promise<void> | null = null
  async function load() {
    if (pending) return pending
    loading.value = true
    error.value = null
    pending = (async () => {
      try {
        config.value = await request('/api/v1/public/config', parsePublic)
      } catch (failure) {
        error.value = failure
      } finally {
        loading.value = false
        pending = null
      }
    })()
    return pending
  }
  return { config, loading, error, load }
})
