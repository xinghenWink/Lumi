<script setup lang="ts">
import { ref, shallowRef, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { images, type ImageFile } from '../../api/images'
import { useAuthStore } from '../../stores/auth'
const props = defineProps<{ file: ImageFile; original?: boolean; alt: string }>()
const { t } = useI18n(),
  auth = useAuthStore(),
  url = ref(''),
  failure = shallowRef<unknown>(),
  retry = ref(0)
let controller: AbortController | undefined
function clear() {
  controller?.abort()
  if (url.value) window.URL.revokeObjectURL(url.value)
  url.value = ''
}
watch(
  [() => props.file, () => props.original, () => auth.user?.id, retry],
  async () => {
    clear()
    failure.value = null
    if (!auth.user) return
    const current = new AbortController()
    controller = current
    try {
      const blob = await images.blob(props.file, !props.original, current.signal)
      if (!current.signal.aborted) url.value = window.URL.createObjectURL(blob)
    } catch (e) {
      if (!current.signal.aborted) failure.value = e
    }
  },
  { immediate: true },
)
onUnmounted(clear)
</script>
<template>
  <img
    v-if="url"
    :src="url"
    :alt="alt"
    :width="original ? file.width : file.thumbnail_width"
    :height="original ? file.height : file.thumbnail_height"
    decoding="async"
  />
  <span v-else-if="failure" class="image-load-error" role="status"
    >{{ t('images.loadFailed')
    }}<button type="button" class="text-button" @click.stop="retry++">
      {{ t('images.refresh') }}
    </button></span
  >
  <span v-else class="image-loading" role="status">{{ t('images.loading') }}</span>
</template>
