import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { getVersion, type Version } from '../api/client'

export const useSystemStore = defineStore('system', () => {
  const version = shallowRef<Version | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')

  async function loadVersion() {
    if (status.value === 'loading') return
    status.value = 'loading'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      version.value = await getVersion(controller.signal)
      status.value = 'ready'
    } catch {
      status.value = 'error'
    } finally {
      clearTimeout(timeout)
    }
  }

  return { version, status, loadVersion }
})
