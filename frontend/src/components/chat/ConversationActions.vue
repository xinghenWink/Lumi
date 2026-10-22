<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui'
import { Ellipsis, Pencil, Pin, Trash2 } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat'
import type { Conversation } from '../../api/chat'
import ModalDialog from '../ModalDialog.vue'
import ApiNotice from '../ApiNotice.vue'
const props = defineProps<{ row: Conversation }>()
const { t } = useI18n(),
  chat = useChatStore()
const modal = ref<'rename' | 'delete' | ''>(''),
  title = ref(''),
  busy = ref(false),
  error = ref<unknown>(null)
function rename() {
  title.value = props.row.title || t('chat.untitled')
  error.value = null
  modal.value = 'rename'
}
function deletion() {
  error.value = null
  modal.value = 'delete'
}
async function pin() {
  error.value = null
  try {
    await chat.update(props.row, props.row.title || t('chat.untitled'), !props.row.pinned)
  } catch (e) {
    error.value = e
    modal.value = 'rename'
    title.value = props.row.title
  }
}
async function confirm() {
  busy.value = true
  error.value = null
  try {
    if (modal.value === 'rename') await chat.update(props.row, title.value)
    else await chat.remove([props.row.id])
    modal.value = ''
  } catch (e) {
    error.value = e
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <DropdownMenuRoot
    ><DropdownMenuTrigger
      class="icon-button"
      :aria-label="t('chat.actions', { name: row.title || t('chat.untitled') })"
      ><Ellipsis :size="16" /></DropdownMenuTrigger
    ><DropdownMenuPortal
      ><DropdownMenuContent
        class="chat-conversation-menu"
        side="bottom"
        align="end"
        :collision-padding="12"
        :aria-labelledby="undefined"
        :aria-label="t('chat.more')"
      >
        <DropdownMenuItem class="menu-item" @select="rename"
          ><Pencil :size="15" />{{ t('chat.rename') }}</DropdownMenuItem
        >
        <DropdownMenuItem class="menu-item" @select="pin"
          ><Pin :size="15" />{{ t(row.pinned ? 'chat.unpin' : 'chat.pin') }}</DropdownMenuItem
        >
        <DropdownMenuItem class="menu-item danger-text" @select="deletion"
          ><Trash2 :size="15" />{{ t('chat.delete') }}</DropdownMenuItem
        >
      </DropdownMenuContent></DropdownMenuPortal
    ></DropdownMenuRoot
  >
  <ModalDialog
    :open="!!modal"
    :busy="busy"
    :title="t(modal === 'rename' ? 'chat.renameTitle' : 'chat.deleteTitle')"
    :description="t(modal === 'rename' ? 'chat.historyHint' : 'chat.deleteHint')"
    @update:open="
      (value) => {
        if (!value) modal = ''
      }
    "
  >
    <form class="stack" @submit.prevent="confirm">
      <ApiNotice :error="error" />
      <label v-if="modal === 'rename'" class="field"
        >{{ t('chat.name') }}<input v-model="title" maxlength="100" required :disabled="busy"
      /></label>
      <div class="dialog-actions">
        <button type="button" class="button" :disabled="busy" @click="modal = ''">
          {{ t('common.cancel') }}</button
        ><button
          class="button"
          :class="modal === 'delete' ? 'danger' : 'primary'"
          :disabled="busy || (modal === 'rename' && !title.trim())"
        >
          {{ t(modal === 'delete' ? 'chat.confirmDelete' : 'chat.save') }}
        </button>
      </div>
    </form>
  </ModalDialog>
</template>
