<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Sparkles } from 'lucide-vue-next'
import { images, type ImageTask, type ImageFile } from '../api/images'
import { ApiError } from '../api/transport'
import { useImageStore } from '../stores/images'
import { useChatStore } from '../stores/chat'
import { useModelStore } from '../stores/models'
import { useAuthStore } from '../stores/auth'
import ImageComposer from '../components/images/ImageComposer.vue'
import ImageTaskList from '../components/images/ImageTaskList.vue'
const store = useImageStore(),
  chat = useChatStore(),
  models = useModelStore(),
  auth = useAuthStore(),
  route = useRoute(),
  router = useRouter(),
  { t } = useI18n()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
void store.initialize()
watch(
  id,
  (value) => {
    void store.open(value)
  },
  { immediate: true },
)
watch(
  () => store.active,
  (value) => {
    if (!value && id.value && !store.loading) void router.replace('/create')
  },
)
watch(
  () => models.items.image,
  () => {
    if (store.current?.model_id) models.select('image', store.current.model_id)
  },
)
onUnmounted(() => store.stopFollowing())
function add(file: ImageFile) {
  const model = models.items.image.find((m) => m.id === models.selected.image)
  if (!model?.capabilities.supports_edit) {
    const compatible = models.items.image.find((m) => m.capabilities.supports_edit)
    if (!compatible) {
      store.error = new ApiError('IMAGE_REFERENCE_INVALID')
      return
    }
    models.select('image', compatible.id)
  }
  const selected = models.items.image.find((m) => m.id === models.selected.image)
  const limit = Math.min(
    store.configuration?.max_references ?? 0,
    selected?.capabilities.max_reference_images ?? 0,
  )
  if (store.draft.references.some((f) => f.id === file.id)) return
  if (store.draft.references.length >= limit) {
    store.error = new ApiError('IMAGE_REFERENCE_INVALID')
    return
  }
  store.draft.references = [...store.draft.references, file]
}
async function reuse(task: ImageTask) {
  const owner = auth.user?.id,
    conversation = store.active
  models.select('image', task.model_id)
  const refs = await Promise.allSettled(task.reference_file_ids.map((id) => images.file(id)))
  if (!owner || owner !== auth.user?.id || conversation !== store.active) return
  store.draft.prompt = task.prompt
  store.draft.quality = task.quality
  store.draft.size = task.size
  store.draft.ratio = task.ratio
  store.draft.n = task.n
  store.draft.references = refs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (refs.some((r) => r.status === 'rejected'))
    store.error = new ApiError('IMAGE_REFERENCE_INVALID')
}
</script>
<template>
  <div class="image-page">
    <div class="chat-page-heading">
      <nav class="catalog-mode-tabs" :aria-label="t('chat.mode')">
        <RouterLink :to="chat.lastOpened ? '/chat/' + chat.lastOpened : '/chat'">{{
          t('chat.chatMode')
        }}</RouterLink
        ><RouterLink :to="store.lastOpened ? '/create/' + store.lastOpened : '/create'">{{
          t('chat.imageMode')
        }}</RouterLink>
      </nav>
      <span v-if="store.current" class="chat-current-title">{{
        store.current.title || t('images.untitled')
      }}</span>
    </div>
    <div v-if="store.loading && !store.tasks.length" class="loading-state" role="status">
      {{ t('images.loading') }}
    </div>
    <ImageTaskList
      v-else-if="store.tasks.length"
      :tasks="store.tasks"
      :older="!!store.older"
      :loading="store.loading"
      @older="store.loadOlder()"
      @cancel="store.cancel"
      @reuse="reuse"
      @edit="add"
      @changed="store.open(store.active)"
    />
    <section v-else class="chat-empty">
      <div class="workspace-emblem"><Sparkles :size="30" :stroke-width="1.5" /></div>
      <h1>{{ t('images.title') }}</h1>
      <p>{{ t('images.description') }}</p>
    </section>
    <ImageComposer />
  </div>
</template>
