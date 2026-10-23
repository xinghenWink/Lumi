<script setup lang="ts">
import { shallowRef, watch, onUnmounted } from 'vue'
import { images, type ImageFile } from '../../api/images'
import ProtectedImage from '../images/ProtectedImage.vue'
const props = defineProps<{ ids: string[] }>(),
  files = shallowRef<ImageFile[]>([])
let controller: AbortController | undefined
watch(
  () => props.ids,
  async (ids) => {
    controller?.abort()
    const active = new AbortController()
    controller = active
    const results = await Promise.allSettled(ids.map((id) => images.file(id, active.signal)))
    if (!active.signal.aborted)
      files.value = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  },
  { immediate: true },
)
onUnmounted(() => controller?.abort())
</script>
<template>
  <div class="chat-reference-images">
    <ProtectedImage v-for="file in files" :key="file.id" :file="file" alt="" />
  </div>
</template>
