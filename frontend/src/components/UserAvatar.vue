<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { images, type ImageFile } from '../api/images'
import ProtectedImage from './images/ProtectedImage.vue'
const auth = useAuthStore(),
  file = shallowRef<ImageFile>()
const initial = computed(() => Array.from(auth.user?.nickname ?? 'L')[0])
watch(
  [() => auth.user?.id, () => auth.user?.avatar_file_id],
  async (_, __, cleanup) => {
    file.value = undefined
    const id = auth.user?.avatar_file_id
    if (!id) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    try {
      const result = await images.file(id, controller.signal)
      if (!controller.signal.aborted) file.value = result
    } catch {
      /* Keep the account initial when an avatar is unavailable. */
    }
  },
  { immediate: true },
)
</script>
<template>
  <span class="avatar"
    ><ProtectedImage v-if="file" :file="file" alt="" /><span v-else>{{ initial }}</span></span
  >
</template>
