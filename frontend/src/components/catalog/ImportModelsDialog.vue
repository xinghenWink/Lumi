<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { catalog } from '../../api/catalog'
import {
  defaultCapabilities,
  type Discovery,
  type ModelKind,
  type Upstream,
} from '../../api/catalog-contracts'
import ModalDialog from '../ModalDialog.vue'
import ApiNotice from '../ApiNotice.vue'
const props = defineProps<{ channel: Upstream }>()
const emit = defineEmits<{ close: []; completed: [count: number] }>()
const { t } = useI18n()
const loading = ref(false),
  busy = ref(false),
  query = ref(''),
  validation = ref('')
const error = shallowRef<unknown>(null),
  discovery = shallowRef<Discovery | null>(null)
const candidates = ref<{ id: string; selected: boolean; name: string; type: ModelKind }[]>([])
const selected = computed(() => candidates.value.filter((item) => item.selected))
const filtered = computed(() =>
  candidates.value.filter((item) =>
    item.id.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
)
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
    const result = await catalog.discover(props.channel.id, controller.signal)
    if (!alive) return
    discovery.value = result
    candidates.value = result.models.map((item, index) => ({
      id: item.id,
      selected: false,
      name: t('catalog.defaultAlias', { index: index + 1 }),
      type: 'chat',
    }))
  } catch (failure) {
    if (alive) error.value = failure
  } finally {
    if (alive) loading.value = false
  }
}
async function save() {
  validation.value = ''
  error.value = null
  if (
    !discovery.value ||
    selected.value.length < 1 ||
    selected.value.length > 100 ||
    selected.value.some((item) => !item.name.trim())
  ) {
    validation.value = t('catalog.invalid')
    return
  }
  busy.value = true
  try {
    const result = await catalog.import(props.channel.id, {
      version: discovery.value.version,
      models: selected.value.map((item) => ({
        remote_id: item.id,
        display_name: item.name.trim(),
        type: item.type,
        capabilities: defaultCapabilities(item.type),
      })),
    })
    if (alive) emit('completed', result.items.length)
  } catch (failure) {
    if (alive) error.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
</script>
<template>
  <ModalDialog
    :open="true"
    :busy="busy"
    :title="t('catalog.syncTitle')"
    :description="t('catalog.syncHint')"
    @update:open="
      (value) => {
        if (!value) emit('close')
      }
    "
  >
    <div v-if="loading" class="loading-state" role="status">{{ t('catalog.discovering') }}</div>
    <ApiNotice :error="error" />
    <button v-if="error && !discovery" class="button" @click="load">{{ t('common.retry') }}</button>
    <form v-if="discovery" class="stack" @submit.prevent="save">
      <label class="field"
        >{{ t('catalog.remoteSearch')
        }}<input v-model="query" :aria-label="t('catalog.remoteSearch')" type="search"
      /></label>
      <div class="catalog-discovery">
        <p v-if="!filtered.length" class="field-hint">{{ t('catalog.noRemoteModels') }}</p>
        <div v-for="item in filtered.slice(0, 100)" :key="item.id" class="catalog-candidate">
          <label class="catalog-candidate-title"
            ><input
              v-model="item.selected"
              type="checkbox"
              :aria-label="t('catalog.selectRemote', { id: item.id })"
              :disabled="busy || (!item.selected && selected.length >= 100)"
            /><code>{{ item.id }}</code></label
          >
          <div v-if="item.selected" class="form-grid">
            <label class="field"
              >{{ t('catalog.modelName')
              }}<input
                v-model="item.name"
                :aria-label="t('catalog.modelName') + ' ' + item.id"
                maxlength="80"
                required
                :disabled="busy"
            /></label>
            <label class="field"
              >{{ t('catalog.type')
              }}<select
                v-model="item.type"
                :aria-label="t('catalog.type') + ' ' + item.id"
                :disabled="busy"
              >
                <option value="chat">{{ t('catalog.chat') }}</option>
                <option value="image">{{ t('catalog.image') }}</option>
              </select></label
            >
          </div>
        </div>
      </div>
      <p v-if="filtered.length > 100" class="field-hint">{{ t('catalog.showFirst') }}</p>
      <p class="field-hint">{{ t('catalog.importHint') }}</p>
      <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
      <div class="dialog-actions">
        <span class="field-hint">{{ t('catalog.selected', { count: selected.length }) }}</span
        ><button class="button" type="button" :disabled="busy" @click="emit('close')">
          {{ t('common.cancel') }}</button
        ><button class="button primary" :disabled="busy || !selected.length">
          {{ t(busy ? 'common.saving' : 'catalog.importModels') }}
        </button>
      </div>
    </form>
  </ModalDialog>
</template>
