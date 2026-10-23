import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'

export function useCursorPage<T extends { next_cursor: string }>(
  fetchPage: (cursor: string, signal: AbortSignal) => Promise<T>,
) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false),
    error = shallowRef<unknown>(null),
    cursors = ref([''])
  const pageNumber = computed(() => cursors.value.length)
  let generation = 0,
    controller: AbortController | null = null,
    alive = true
  async function load() {
    if (!alive) return
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    loading.value = true
    error.value = null
    try {
      const result = await fetchPage(cursors.value.at(-1) ?? '', controller.signal)
      if (current === generation) data.value = result
    } catch (failure) {
      if (
        current === generation &&
        !(failure instanceof DOMException && failure.name === 'AbortError')
      ) {
        error.value = failure
        data.value = null
      }
    } finally {
      if (current === generation) loading.value = false
    }
  }
  function reset() {
    cursors.value = ['']
    return load()
  }
  function next() {
    if (data.value?.next_cursor && !loading.value) {
      cursors.value = [...cursors.value, data.value.next_cursor]
      void load()
    }
  }
  function previous() {
    if (cursors.value.length > 1 && !loading.value) {
      cursors.value = cursors.value.slice(0, -1)
      void load()
    }
  }
  onMounted(() => void load())
  onUnmounted(() => {
    alive = false
    generation++
    controller?.abort()
  })
  return { data, loading, error, pageNumber, reset, load, next, previous }
}

// An uncertain response keeps its key; confirmation or a changed payload starts a new operation.
export function useMutationKey() {
  let payload = '',
    key = ''
  return {
    forPayload(value: unknown) {
      const next = JSON.stringify(value)
      if (next !== payload || !key) {
        payload = next
        key = window.crypto.randomUUID()
      }
      return key
    },
    complete() {
      payload = ''
      key = ''
    },
  }
}
