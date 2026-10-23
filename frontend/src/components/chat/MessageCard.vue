<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, RefreshCw, Pencil, Sparkles } from 'lucide-vue-next'
import type { Message } from '../../api/chat'
const props = defineProps<{
  message: Message
  lastUser: boolean
  lastAssistant: boolean
  busy: boolean
}>()
const emit = defineEmits<{ edit: [message: Message]; regenerate: [] }>()
const Markdown = defineAsyncComponent(() => import('./MarkdownContent.vue'))
const References = defineAsyncComponent(() => import('./ChatReferences.vue'))
const { t } = useI18n()
const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>
<template>
  <article
    class="chat-message"
    :class="'chat-message-' + message.role"
    :data-message-id="message.id"
  >
    <div class="chat-message-author">
      <Sparkles v-if="message.role === 'assistant'" :size="18" /><span>{{
        t(message.role === 'user' ? 'chat.you' : 'chat.assistant')
      }}</span>
    </div>
    <p v-if="message.role === 'user'" class="chat-user-text">{{ message.content }}</p>
    <References v-if="message.reference_file_ids?.length" :ids="message.reference_file_ids" />
    <div v-else>
      <Markdown
        v-if="message.content"
        :content="message.content"
        :complete="message.status !== 'streaming'"
      />
      <p v-else-if="message.status === 'streaming'" class="chat-waiting" role="status">
        {{ t('chat.waiting') }}
      </p>
      <p v-if="message.status === 'error' || message.status === 'interrupted'" class="field-hint">
        {{ t(message.status === 'error' ? 'chat.error' : 'chat.interrupted')
        }}<span v-if="message.meta.error_code">
          · {{ t('errors.' + message.meta.error_code) }}</span
        >
      </p>
    </div>
    <div class="chat-message-actions">
      <button
        v-if="message.content"
        class="icon-button"
        :aria-label="t(copied ? 'chat.copied' : 'chat.copy')"
        @click="copy"
      >
        <Copy :size="15" />
      </button>
      <button
        v-if="lastUser"
        class="icon-button"
        :disabled="busy"
        :aria-label="t('chat.edit')"
        @click="emit('edit', message)"
      >
        <Pencil :size="15" />
      </button>
      <button
        v-if="lastAssistant"
        class="icon-button"
        :disabled="busy"
        :aria-label="t(message.status === 'completed' ? 'chat.regenerate' : 'chat.retry')"
        @click="emit('regenerate')"
      >
        <RefreshCw :size="15" />
      </button>
      <span v-if="message.meta.usage" class="field-hint">{{
        t('chat.tokens', { count: message.meta.usage.total_tokens })
      }}</span>
    </div>
  </article>
</template>
