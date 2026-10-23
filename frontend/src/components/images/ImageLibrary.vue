<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { images, type ImageFile } from '../../api/images'
import { useAuthStore } from '../../stores/auth'
import ModalDialog from '../ModalDialog.vue'
import ApiNotice from '../ApiNotice.vue'
import ProtectedImage from './ProtectedImage.vue'
const props = defineProps<{ open: boolean }>(),
  emit = defineEmits<{ 'update:open': [boolean]; choose: [ImageFile] }>()
const { t } = useI18n(),
  auth = useAuthStore(),
  items = shallowRef<ImageFile[]>([]),
  cursor = ref(''),
  loading = ref(false),
  error = shallowRef<unknown>()
let controller: AbortController | undefined
async function load(more = false) {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = null
  try {
    const q = new URLSearchParams({ limit: '40' })
    if (more) q.set('cursor', cursor.value)
    const page = await images.library(q, current.signal)
    if (current.signal.aborted) return
    items.value = more ? [...items.value, ...page.items] : page.items
    cursor.value = page.next_cursor
  } catch (e) {
    if (!current.signal.aborted) error.value = e
  } finally {
    if (!current.signal.aborted) loading.value = false
  }
}
watch([() => props.open, () => auth.user?.id], ([open]) => {
  controller?.abort()
  items.value = []
  cursor.value = ''
  if (open && auth.user) void load()
})
function choose(file: ImageFile) {
  emit('choose', file)
  emit('update:open', false)
}
</script>
<template>
  <ModalDialog
    :open="open"
    :title="t('images.library')"
    :description="t('images.referenceHint', { size: 10 })"
    wide
    @update:open="emit('update:open', $event)"
  >
    <ApiNotice :error="error" />
    <div class="image-library-grid">
      <button
        v-for="file in items"
        :key="file.id"
        class="image-library-item"
        :aria-label="t('images.choose') + ' ' + file.created_at"
        @click="choose(file)"
      >
        <ProtectedImage :file="file" :alt="t('images.references')" />
      </button>
    </div>
    <p v-if="!loading && !items.length" class="empty-state">{{ t('images.emptyGallery') }}</p>
    <button v-if="cursor" class="button" :disabled="loading" @click="load(true)">
      {{ t('images.more') }}
    </button>
  </ModalDialog>
</template>
