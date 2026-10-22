<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp, Square } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat'
import { useModelStore } from '../../stores/models'
import { useAuthStore } from '../../stores/auth'
import ModelPicker from '../catalog/ModelPicker.vue'
import ApiNotice from '../ApiNotice.vue'
import { images, type ImageFile } from '../../api/images'
import { ApiError } from '../../api/transport'
const props = defineProps<{ image?: boolean }>()
const { t } = useI18n(),
  router = useRouter(),
  chat = useChatStore(),
  models = useModelStore()
const auth = useAuthStore()
const pending = ref(false),
  error = ref<unknown>(null)
const references = ref<ImageFile[]>([]),
  uploading = ref(false)
const vision = computed(
  () => models.items.chat.find((m) => m.id === models.selected.chat)?.capabilities.vision === true,
)
let uploadController: AbortController | undefined
function resetReferences() {
  uploadController?.abort()
  references.value = []
  uploading.value = false
}
watch(() => [chat.active, auth.user?.id], resetReferences)
onUnmounted(resetReferences)
async function upload(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadController?.abort()
  const controller = new AbortController()
  uploadController = controller
  const owner = auth.user?.id,
    conversation = chat.active
  uploading.value = true
  error.value = null
  try {
    if (references.value.length >= 4) throw new ApiError('INVALID_INPUT')
    const uploaded = await images.upload(file, controller.signal)
    if (!controller.signal.aborted && owner === auth.user?.id && conversation === chat.active)
      references.value = [...references.value, uploaded]
  } catch (e) {
    if (!controller.signal.aborted) error.value = e
  } finally {
    if (!controller.signal.aborted) uploading.value = false
  }
}
const key = computed(() => (props.image ? 'image-draft' : chat.active || 'new'))
const draft = computed({
  get: () => chat.drafts[key.value] ?? '',
  set: (value: string) => {
    chat.drafts[key.value] = value
  },
})
async function send() {
  if (
    props.image ||
    chat.busy ||
    pending.value ||
    uploading.value ||
    !draft.value.trim() ||
    !models.selected.chat
  )
    return
  const text = draft.value,
    oldKey = key.value,
    referenceIDs = vision.value ? references.value.map((file) => file.id) : []
  pending.value = true
  error.value = null
  try {
    const id = chat.active || (await chat.create(models.selected.chat))
    await router.replace('/chat/' + id)
    chat.drafts[oldKey] = ''
    void chat.send(id, {
      request_id: crypto.randomUUID(),
      model_id: models.selected.chat,
      action: 'send',
      content: text,
      reference_file_ids: referenceIDs,
    })
    references.value = []
  } catch (failure) {
    error.value = failure
  } finally {
    pending.value = false
  }
}
function enter(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void send()
  }
}
</script>
<template>
  <section class="chat-composer-wrap">
    <ApiNotice :error="error" />
    <form class="panel chat-composer" @submit.prevent="send">
      <div v-if="vision" class="ops-toolbar">
        <label class="button"
          >{{ t('ops.reference')
          }}<input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="sr-only"
            :disabled="uploading || pending || references.length >= 4"
            @change="upload" /></label
        ><button
          v-for="file in references"
          :key="file.id"
          type="button"
          class="button"
          :aria-label="t('ops.removeReference')"
          @click="references = references.filter((item) => item.id !== file.id)"
        >
          {{ file.width }} × {{ file.height }} · ×
        </button>
      </div>
      <textarea
        v-model="draft"
        :aria-label="t('chat.input')"
        :placeholder="t(image ? 'catalog.creationComing' : 'chat.placeholder')"
        :disabled="image || pending"
        maxlength="64000"
        rows="3"
        @keydown="enter"
      />
      <div class="chat-composer-bottom">
        <span class="chat-input-hint">{{ t('chat.sendHint') }}</span>
        <div class="chat-composer-actions">
          <ModelPicker :kind="image ? 'image' : 'chat'" />
          <button
            v-if="!image && chat.busy"
            class="button chat-stop"
            type="button"
            :aria-label="t('chat.stop')"
            @click="chat.stop()"
          >
            <Square :size="15" /><span>{{ t('chat.stop') }}</span>
          </button>
          <button
            v-else
            class="button primary chat-send"
            :aria-label="t('chat.send')"
            :disabled="image || pending || uploading || !draft.trim() || !models.selected.chat"
          >
            <ArrowUp :size="19" />
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
