<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessageSquare, Pin, Trash2 } from 'lucide-vue-next'
import { useChatStore } from '../stores/chat'
import { useTime } from '../features/accounts/time'
import ConversationActions from '../components/chat/ConversationActions.vue'
import ModalDialog from '../components/ModalDialog.vue'
import ApiNotice from '../components/ApiNotice.vue'
import { operations } from '../api/operations'
const { t } = useI18n(),
  chat = useChatStore(),
  time = useTime()
const search = ref(chat.query),
  selected = ref<string[]>([]),
  modal = ref<'selected' | 'all' | ''>(''),
  busy = ref(false),
  error = ref<unknown>(null)
onMounted(() => void chat.list())
function apply() {
  chat.query = search.value
  selected.value = []
  void chat.list()
}
async function exportChats(format: 'json' | 'markdown') {
  busy.value = true
  error.value = null
  try {
    await operations.exportChats(format)
  } catch (e) {
    error.value = e
  } finally {
    busy.value = false
  }
}
async function remove() {
  busy.value = true
  error.value = null
  try {
    await chat.remove(modal.value === 'all' ? [] : selected.value, modal.value === 'all')
    selected.value = []
    modal.value = ''
  } catch (e) {
    error.value = e
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-container chat-history">
    <div class="page-heading">
      <div>
        <h1>{{ t('chat.history') }}</h1>
        <p>{{ t('chat.historyHint') }}</p>
      </div>
      <RouterLink class="button primary" to="/chat">{{ t('chat.newChat') }}</RouterLink>
    </div>
    <form class="filter-panel catalog-filters" @submit.prevent="apply">
      <input
        v-model="search"
        type="search"
        :aria-label="t('chat.search')"
        :placeholder="t('chat.search')"
        maxlength="100"
      /><button class="button" :disabled="chat.loading">{{ t('common.search') }}</button>
    </form>
    <ApiNotice :error="chat.listError" />
    <div class="chat-history-tools">
      <button class="button" :disabled="busy" @click="exportChats('json')">
        {{ t('ops.exportJSON') }}</button
      ><button class="button" :disabled="busy" @click="exportChats('markdown')">
        {{ t('ops.exportMarkdown') }}</button
      ><ApiNotice :error="error" /> <span>{{ t('chat.selected', { count: selected.length }) }}</span
      ><button class="button" :disabled="!selected.length" @click="modal = 'selected'">
        <Trash2 :size="14" />{{ t('chat.deleteSelected') }}</button
      ><button class="text-button danger-text" @click="modal = 'all'">
        {{ t('chat.clearAll') }}
      </button>
    </div>
    <div class="panel data-panel">
      <div v-if="chat.loading && !chat.conversations.length" class="loading-state" role="status">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="!chat.conversations.length" class="empty-state">
        <MessageSquare :size="30" />
        <h2>{{ t('chat.empty') }}</h2>
        <p>{{ t('chat.emptyHint') }}</p>
      </div>
      <ul v-else class="chat-history-list">
        <li v-for="row in chat.conversations" :key="row.id">
          <input
            v-model="selected"
            type="checkbox"
            :value="row.id"
            :aria-label="t('chat.select', { name: row.title || t('chat.untitled') })"
          /><RouterLink :to="'/chat/' + row.id"
            ><strong
              ><Pin v-if="row.pinned" :size="13" />{{ row.title || t('chat.untitled') }}</strong
            ><span>{{ time(row.last_message_at) }}</span></RouterLink
          ><ConversationActions :row="row" />
        </li>
      </ul>
      <div v-if="chat.cursor" class="chat-history-more">
        <button class="button" :disabled="chat.loading" @click="chat.list(true)">
          {{ t('chat.loadMore') }}
        </button>
      </div>
    </div>
  </div>
  <ModalDialog
    :open="!!modal"
    :busy="busy"
    :title="t(modal === 'all' ? 'chat.clearTitle' : 'chat.deleteTitle')"
    :description="t(modal === 'all' ? 'chat.clearHint' : 'chat.deleteHint')"
    @update:open="
      (value) => {
        if (!value) modal = ''
      }
    "
    ><form class="stack" @submit.prevent="remove">
      <ApiNotice :error="error" />
      <div class="dialog-actions">
        <button type="button" class="button" :disabled="busy" @click="modal = ''">
          {{ t('common.cancel') }}</button
        ><button class="button danger" :disabled="busy">{{ t('chat.confirmDelete') }}</button>
      </div>
    </form></ModalDialog
  >
</template>
