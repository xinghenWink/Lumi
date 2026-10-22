<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp, Square } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat'
import { useModelStore } from '../../stores/models'
import ModelPicker from '../catalog/ModelPicker.vue'
import ApiNotice from '../ApiNotice.vue'
const props = defineProps<{ image?: boolean }>()
const { t } = useI18n(),
  router = useRouter(),
  chat = useChatStore(),
  models = useModelStore()
const pending = ref(false),
  error = ref<unknown>(null)
const key = computed(() => (props.image ? 'image-draft' : chat.active || 'new'))
const draft = computed({
  get: () => chat.drafts[key.value] ?? '',
  set: (value: string) => {
    chat.drafts[key.value] = value
  },
})
async function send() {
  if (props.image || chat.busy || pending.value || !draft.value.trim() || !models.selected.chat)
    return
  const text = draft.value,
    oldKey = key.value
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
    })
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
            :disabled="image || pending || !draft.trim() || !models.selected.chat"
          >
            <ArrowUp :size="19" />
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
