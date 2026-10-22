<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Sparkles } from 'lucide-vue-next'
import { useChatStore } from '../stores/chat'
import { useModelStore } from '../stores/models'
import type { Message } from '../api/chat'
import { lastMessage } from '../features/chat/messages'
import ChatComposer from '../components/chat/ChatComposer.vue'
import MessageList from '../components/chat/MessageList.vue'
import ConversationActions from '../components/chat/ConversationActions.vue'
import ApiNotice from '../components/ApiNotice.vue'
import ModalDialog from '../components/ModalDialog.vue'
const route = useRoute(),
  router = useRouter(),
  { t } = useI18n(),
  chat = useChatStore(),
  models = useModelStore()
const image = computed(() => route.path.startsWith('/create'))
const editing = ref<Message | null>(null),
  edited = ref('')
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
watch(
  [id, image],
  async ([value, isImage]) => {
    if (!isImage) await chat.open(value)
  },
  { immediate: true },
)
watch(
  () => chat.current?.model_id,
  (model) => {
    if (model && models.items.chat.some((m) => m.id === model)) models.select('chat', model)
  },
)
watch(
  () => models.items.chat,
  () => {
    const model = chat.current?.model_id
    if (model && models.items.chat.some((m) => m.id === model)) models.select('chat', model)
  },
)
function edit(message: Message) {
  editing.value = message
  edited.value = message.content
}
async function editSend() {
  const message = editing.value
  if (!message || !chat.active || !models.selected.chat) return
  editing.value = null
  await chat.send(chat.active, {
    request_id: crypto.randomUUID(),
    model_id: models.selected.chat,
    action: 'edit',
    content: edited.value,
    last_message_id: message.id,
  })
}
function regenerate() {
  const last = lastMessage(chat.messages, 'user')
  if (!last || !chat.active || !models.selected.chat) return
  void chat.send(chat.active, {
    request_id: crypto.randomUUID(),
    model_id: models.selected.chat,
    action: 'regenerate',
    content: '',
    last_message_id: last.id,
  })
}
watch(
  () => chat.active,
  (value) => {
    if (!image.value && !value && id.value) void router.replace('/chat')
  },
)
</script>
<template>
  <div class="chat-page">
    <div class="chat-page-heading">
      <nav class="catalog-mode-tabs" :aria-label="t('chat.mode')">
        <RouterLink :to="chat.lastOpened ? '/chat/' + chat.lastOpened : '/chat'">{{
          t('chat.chatMode')
        }}</RouterLink
        ><RouterLink to="/create">{{ t('chat.imageMode') }}</RouterLink>
      </nav>
      <div v-if="!image && chat.current" class="chat-current-title">
        <span>{{ chat.current.title || t('chat.untitled') }}</span
        ><ConversationActions :row="chat.current" />
      </div>
    </div>
    <div
      v-if="!image && chat.messageLoading && !chat.messages.length"
      class="loading-state"
      role="status"
    >
      {{ t('chat.loading') }}
    </div>
    <MessageList
      v-else-if="!image && chat.messages.length"
      :items="chat.messages"
      :busy="chat.busy"
      :has-older="!!chat.older[chat.active]"
      :loading="chat.messageLoading"
      @older="chat.loadOlder()"
      @edit="edit"
      @regenerate="regenerate"
    />
    <section v-else class="chat-empty">
      <div class="workspace-emblem"><Sparkles :size="30" :stroke-width="1.5" /></div>
      <h1>{{ t(image ? 'workspace.title' : 'chat.title') }}</h1>
      <p>{{ t(image ? 'catalog.creationComing' : 'chat.description') }}</p>
    </section>
    <div v-if="!image && chat.errors[chat.active]" class="chat-stream-error">
      <ApiNotice :error="chat.errors[chat.active]" /><button
        v-if="chat.hasPending && !chat.busy"
        class="button compact"
        @click="chat.retryPending()"
      >
        {{ t('chat.retry') }}
      </button>
    </div>
    <ChatComposer :image="image" />
  </div>
  <ModalDialog
    :open="!!editing"
    :title="t('chat.editTitle')"
    :description="t('chat.editHint')"
    @update:open="
      (value) => {
        if (!value) editing = null
      }
    "
    ><form class="stack" @submit.prevent="editSend">
      <label class="field"
        >{{ t('chat.input') }}<textarea v-model="edited" rows="6" maxlength="64000" required />
      </label>
      <div class="dialog-actions">
        <button type="button" class="button" @click="editing = null">
          {{ t('common.cancel') }}</button
        ><button class="button primary" :disabled="!edited.trim()">{{ t('chat.saveEdit') }}</button>
      </div>
    </form></ModalDialog
  >
</template>
