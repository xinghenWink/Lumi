<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { chats, type ChatConfiguration } from '../../api/chat'
import { catalog } from '../../api/catalog'
import type { PublicModel } from '../../api/catalog-contracts'
import ApiNotice from '../../components/ApiNotice.vue'
const { t } = useI18n()
const data = ref<ChatConfiguration | null>(null),
  models = ref<PublicModel[]>([]),
  error = ref<unknown>(null),
  busy = ref(false),
  loading = ref(false),
  notice = ref('')
const controller = new AbortController()
let alive = true
onMounted(() => void load())
onUnmounted(() => {
  alive = false
  controller.abort()
})
async function load() {
  loading.value = true
  error.value = null
  try {
    const [config, candidates] = await Promise.all([
      chats.settings(controller.signal),
      catalog.public('chat', controller.signal),
    ])
    if (alive) {
      data.value = config
      models.value = candidates.items
    }
  } catch (e) {
    if (alive) error.value = e
  } finally {
    if (alive) loading.value = false
  }
}
async function save() {
  if (!data.value) return
  busy.value = true
  error.value = null
  notice.value = ''
  try {
    const result = await chats.saveSettings(data.value)
    if (alive) {
      data.value = result
      notice.value = t('chat.saved')
    }
  } catch (e) {
    if (alive) error.value = e
  } finally {
    if (alive) busy.value = false
  }
}
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('chat.settings') }}</h1>
        <p>{{ t('chat.settingsHint') }}</p>
      </div>
    </div>
    <ApiNotice :error="error" />
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
    <button v-else-if="!data" class="button" @click="load">{{ t('common.retry') }}</button>
    <form v-else class="panel panel-body stack chat-settings-panel" @submit.prevent="save">
      <div class="form-grid">
        <label class="field"
          >{{ t('chat.perMinute')
          }}<input
            v-model.number="data.per_minute"
            type="number"
            min="0"
            max="1000"
            step="1"
            required
            :disabled="busy" /></label
        ><label class="field"
          >{{ t('chat.perDay')
          }}<input
            v-model.number="data.per_day"
            type="number"
            min="0"
            max="100000"
            step="1"
            required
            :disabled="busy"
        /></label>
      </div>
      <p class="field-hint">{{ t('chat.quotaHint') }}</p>
      <div class="form-grid">
        <label class="field"
          >{{ t('chat.contextMessages')
          }}<input
            v-model.number="data.context_messages"
            type="number"
            min="1"
            max="200"
            step="1"
            required
            :disabled="busy" /></label
        ><label class="field"
          >{{ t('chat.contextTokens')
          }}<input
            v-model.number="data.context_tokens"
            type="number"
            min="128"
            max="1000000"
            step="1"
            required
            :disabled="busy"
        /></label>
      </div>
      <p class="field-hint">{{ t('chat.contextHint') }}</p>
      <label class="field"
        >{{ t('chat.system')
        }}<textarea v-model="data.system_prompt" rows="6" maxlength="32000" :disabled="busy" />
      </label>
      <label class="field"
        >{{ t('chat.titleModel')
        }}<select v-model="data.title_model_id" :disabled="busy">
          <option :value="null">{{ t('chat.sameModel') }}</option>
          <option
            v-if="data.title_model_id && !models.some((m) => m.id === data?.title_model_id)"
            :value="data.title_model_id"
          >
            {{ t('chat.unavailableModel') }}
          </option>
          <option v-for="model in models" :key="model.id" :value="model.id">
            {{ model.display_name }}
          </option>
        </select></label
      >
      <div class="dialog-actions">
        <button class="button primary" :disabled="busy">
          {{ t(busy ? 'common.saving' : 'chat.save') }}
        </button>
      </div>
    </form>
  </div>
</template>
