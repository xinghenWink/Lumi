<script setup lang="ts">
import { reactive, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Pencil, Trash2, Plug, RefreshCw, Server } from 'lucide-vue-next'
import { catalog } from '../../api/catalog'
import { ApiError } from '../../api/transport'
import type { Upstream, UpstreamInput, ConnectionTest } from '../../api/catalog-contracts'
import { useCursorPage } from '../../features/credits/resources'
import ApiNotice from '../../components/ApiNotice.vue'
import ModalDialog from '../../components/ModalDialog.vue'
import CursorControls from '../../components/credits/CursorControls.vue'
import ImportModelsDialog from '../../components/catalog/ImportModelsDialog.vue'
const { t, te } = useI18n()
const filters = reactive({ search: '', state: '' })
let applied = { ...filters }
const { data, loading, error, load, reset, next, previous, pageNumber } = useCursorPage(
  (cursor, signal) =>
    catalog.channels(new URLSearchParams({ ...applied, cursor, limit: '20' }), signal),
)
function search() {
  applied = { ...filters }
  void reset()
}
const formOpen = ref(false),
  busy = ref(false),
  validation = ref(''),
  notice = ref(''),
  key = ref(''),
  testing = ref('')
const modalError = shallowRef<unknown>(null),
  actionError = shallowRef<unknown>(null)
const selected = shallowRef<Upstream | null>(null),
  deleting = shallowRef<Upstream | null>(null),
  syncing = shallowRef<Upstream | null>(null)
const tests = shallowRef(new Map<string, ConnectionTest & { version: number }>())
const form = reactive<UpstreamInput>({
  version: 0,
  name: '',
  base_url: '',
  timeout_chat_s: 120,
  timeout_image_s: 180,
  proxy_url: '',
  enabled: true,
  priority: 0,
  weight: 1,
  edit_format: 'multipart',
  note: '',
})
function editable(row: Upstream): UpstreamInput {
  return {
    version: row.version,
    name: row.name,
    base_url: row.base_url,
    timeout_chat_s: row.timeout_chat_s,
    timeout_image_s: row.timeout_image_s,
    proxy_url: row.proxy_url,
    enabled: row.enabled,
    priority: row.priority,
    weight: row.weight,
    edit_format: row.edit_format,
    note: row.note,
  }
}
function open(row?: Upstream) {
  selected.value = row ?? null
  key.value = ''
  modalError.value = null
  validation.value = ''
  Object.assign(
    form,
    row
      ? editable(row)
      : {
          version: 0,
          name: '',
          base_url: '',
          timeout_chat_s: 120,
          timeout_image_s: 180,
          proxy_url: '',
          enabled: true,
          priority: 0,
          weight: 1,
          edit_format: 'multipart',
          note: '',
        },
  )
  formOpen.value = true
}
function close(value: boolean) {
  formOpen.value = value
  if (!value) key.value = ''
}
async function save() {
  modalError.value = null
  validation.value = ''
  if (!form.name.trim() || !form.base_url.trim() || (!selected.value && !key.value.trim())) {
    validation.value = t('catalog.invalid')
    return
  }
  busy.value = true
  try {
    await catalog.saveChannel(
      {
        ...form,
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        api_key: key.value.trim() || null,
      },
      selected.value?.id,
    )
    close(false)
    notice.value = t('catalog.channelSaved')
    await reset()
  } catch (failure) {
    modalError.value = failure
  } finally {
    busy.value = false
  }
}
async function toggle(row: Upstream) {
  busy.value = true
  actionError.value = null
  try {
    await catalog.saveChannel({ ...editable(row), enabled: !row.enabled }, row.id)
    tests.value.delete(row.id)
    notice.value = t('catalog.channelSaved')
    await load()
  } catch (failure) {
    actionError.value = failure
  } finally {
    busy.value = false
  }
}
async function test(row: Upstream) {
  testing.value = row.id
  actionError.value = null
  try {
    const result = await catalog.test(row.id)
    if (data.value?.items.some((item) => item.id === row.id && item.version === row.version))
      tests.value = new Map(tests.value).set(row.id, { ...result, version: row.version })
  } catch (failure) {
    actionError.value = failure
  } finally {
    testing.value = ''
  }
}
async function remove() {
  if (!deleting.value) return
  busy.value = true
  modalError.value = null
  try {
    await catalog.deleteChannel(deleting.value.id)
    deleting.value = null
    notice.value = t('catalog.channelDeleted')
    await reset()
  } catch (failure) {
    modalError.value = failure
  } finally {
    busy.value = false
  }
}
function openDelete(row: Upstream) {
  deleting.value = row
  modalError.value = null
}
function imported(count: number) {
  syncing.value = null
  notice.value = t('catalog.imported', { count })
}
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('catalog.channelsTitle') }}</h1>
        <p>{{ t('catalog.channelsDescription') }}</p>
      </div>
      <button class="button primary" @click="open()">
        <Plus :size="16" />{{ t('catalog.newChannel') }}
      </button>
    </div>
    <form class="filter-panel catalog-filters" @submit.prevent="search">
      <input
        v-model="filters.search"
        type="search"
        :aria-label="t('catalog.searchChannels')"
        :placeholder="t('catalog.searchChannels')"
        maxlength="100"
      /><select v-model="filters.state" :aria-label="t('catalog.allStates')">
        <option value="">{{ t('catalog.allStates') }}</option>
        <option value="enabled">{{ t('catalog.enabledState') }}</option>
        <option value="disabled">{{ t('catalog.disabledState') }}</option></select
      ><button class="button" :disabled="loading">{{ t('common.search') }}</button>
    </form>
    <ApiNotice :error="error || actionError" />
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <div class="panel data-panel" :aria-busy="loading">
      <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="empty-state">
        <button class="button" @click="load">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!data?.items.length" class="empty-state">
        <Server :size="30" />
        <h2>{{ t('catalog.noChannels') }}</h2>
        <p>{{ t('catalog.noChannelsHint') }}</p>
      </div>
      <div v-else class="table-scroll">
        <table class="catalog-channel-table">
          <thead>
            <tr>
              <th>{{ t('catalog.channelName') }}</th>
              <th>{{ t('catalog.baseURL') }}</th>
              <th>{{ t('catalog.enabled') }}</th>
              <th>{{ t('catalog.priority') }} / {{ t('catalog.weight') }}</th>
              <th>{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.items" :key="row.id">
              <td>
                <strong>{{ row.name }}</strong
                ><code class="table-secondary compact-id">{{ row.id }}</code
                ><span class="table-secondary">{{
                  t(row.api_key_configured ? 'catalog.keySaved' : 'catalog.keyMissing')
                }}</span>
                <span v-if="row.circuit_state" class="table-secondary"
                  >{{ t('ops.circuit_' + row.circuit_state) }} ·
                  {{ row.consecutive_failures }}</span
                ><span v-if="row.last_error" class="danger-text">{{
                  t(
                    te('errors.' + row.last_error)
                      ? 'errors.' + row.last_error
                      : 'errors.UNKNOWN_ERROR',
                  )
                }}</span>
              </td>
              <td>
                <code class="catalog-url">{{ row.base_url }}</code
                ><span v-if="row.note" class="table-secondary">{{ row.note }}</span>
                <div v-if="tests.get(row.id)?.version === row.version" class="catalog-test-result">
                  <p
                    :class="tests.get(row.id)?.success ? 'success-message' : 'danger-text'"
                    :role="tests.get(row.id)?.success ? 'status' : 'alert'"
                  >
                    {{
                      tests.get(row.id)?.success
                        ? t('catalog.connectionOK', {
                            count: tests.get(row.id)?.model_count,
                            ms: tests.get(row.id)?.latency_ms,
                          })
                        : t('catalog.connectionFailed', { ms: tests.get(row.id)?.latency_ms })
                    }}
                  </p>
                  <ApiNotice
                    v-if="tests.get(row.id)?.error_code"
                    :error="new ApiError(tests.get(row.id)?.error_code ?? 'UNKNOWN_ERROR')"
                  />
                </div>
              </td>
              <td>
                <span class="badge" :class="row.enabled ? 'green' : 'red'">{{
                  t(row.enabled ? 'catalog.enabledState' : 'catalog.disabledState')
                }}</span>
              </td>
              <td class="numeric">{{ row.priority }} / {{ row.weight }}</td>
              <td>
                <div class="row-actions">
                  <button class="button compact" :disabled="!!testing" @click="test(row)">
                    <Plug :size="14" />{{
                      t(testing === row.id ? 'catalog.testing' : 'catalog.test')
                    }}</button
                  ><button class="button compact" @click="syncing = row">
                    <RefreshCw :size="14" />{{ t('catalog.sync') }}</button
                  ><button
                    class="icon-button"
                    :aria-label="t('catalog.editChannel') + ' ' + row.name"
                    @click="open(row)"
                  >
                    <Pencil :size="16" /></button
                  ><button class="text-button" :disabled="busy" @click="toggle(row)">
                    {{ t(row.enabled ? 'credits.disable' : 'credits.enable') }}</button
                  ><button
                    class="icon-button danger-text"
                    :aria-label="t('catalog.deleteChannel') + ' ' + row.name"
                    @click="openDelete(row)"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CursorControls
        v-if="data"
        :page="pageNumber"
        :next-cursor="data.next_cursor"
        :loading="loading"
        @next="next"
        @previous="previous"
      />
    </div>
    <ModalDialog
      :open="formOpen"
      :busy="busy"
      :title="t(selected ? 'catalog.editChannel' : 'catalog.newChannel')"
      :description="t('catalog.channelFormHint')"
      @update:open="close"
    >
      <form class="stack" @submit.prevent="save">
        <div class="form-grid">
          <label class="field"
            >{{ t('catalog.channelName')
            }}<input v-model="form.name" maxlength="80" required :disabled="busy"
          /></label>
          <label class="field"
            >{{ t('catalog.baseURL')
            }}<input
              v-model="form.base_url"
              type="url"
              :placeholder="t('catalog.basePlaceholder')"
              required
              :disabled="busy"
          /></label>
        </div>
        <label class="field"
          >{{ t('catalog.apiKey')
          }}<input
            v-model="key"
            type="password"
            autocomplete="new-password"
            maxlength="4096"
            :required="!selected"
            :placeholder="t('catalog.keyPlaceholder')"
            :disabled="busy"
        /></label>
        <div class="form-grid">
          <label class="field"
            >{{ t('catalog.chatTimeout')
            }}<input
              v-model.number="form.timeout_chat_s"
              type="number"
              min="1"
              max="600"
              step="1"
              required
              :disabled="busy" /></label
          ><label class="field"
            >{{ t('catalog.imageTimeout')
            }}<input
              v-model.number="form.timeout_image_s"
              type="number"
              min="1"
              max="600"
              step="1"
              required
              :disabled="busy"
          /></label>
        </div>
        <label class="field"
          >{{ t('catalog.proxyURL')
          }}<input
            v-model="form.proxy_url"
            type="url"
            :aria-label="t('catalog.proxyURL')"
            :disabled="busy"
          /><span class="field-hint">{{ t('catalog.proxyHint') }}</span></label
        >
        <div class="form-grid">
          <label class="field"
            >{{ t('catalog.priority')
            }}<input
              v-model.number="form.priority"
              type="number"
              min="0"
              max="10000"
              step="1"
              required
              :disabled="busy" /></label
          ><label class="field"
            >{{ t('catalog.weight')
            }}<input
              v-model.number="form.weight"
              type="number"
              min="1"
              max="10000"
              step="1"
              required
              :disabled="busy" /></label
          ><label class="field"
            >{{ t('catalog.editFormat')
            }}<select
              v-model="form.edit_format"
              :aria-label="t('catalog.editFormat')"
              :disabled="busy"
            >
              <option value="multipart">{{ t('catalog.multipart') }}</option>
              <option value="json">{{ t('catalog.json') }}</option>
            </select></label
          >
        </div>
        <label class="field"
          >{{ t('catalog.note')
          }}<textarea v-model="form.note" maxlength="500" rows="2" :disabled="busy" /></label
        ><label class="checkbox-label"
          ><input v-model="form.enabled" type="checkbox" :disabled="busy" />{{
            t('catalog.enabled')
          }}</label
        >
        <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
        <ApiNotice :error="modalError" />
        <div class="dialog-actions">
          <button class="button" type="button" :disabled="busy" @click="close(false)">
            {{ t('common.cancel') }}</button
          ><button class="button primary" :disabled="busy">
            {{ t(busy ? 'common.saving' : 'catalog.saveChannel') }}
          </button>
        </div>
      </form>
    </ModalDialog>
    <ModalDialog
      :open="!!deleting"
      :busy="busy"
      :title="t('catalog.deleteChannel')"
      :description="t('catalog.deleteChannelHint', { name: deleting?.name ?? '' })"
      @update:open="
        (value) => {
          if (!value) deleting = null
        }
      "
      ><ApiNotice :error="modalError" />
      <div class="dialog-actions">
        <button class="button" :disabled="busy" @click="deleting = null">
          {{ t('common.cancel') }}</button
        ><button class="button danger" :disabled="busy" @click="remove">
          {{ t('catalog.confirmDelete') }}
        </button>
      </div></ModalDialog
    >
    <ImportModelsDialog
      v-if="syncing"
      :channel="syncing"
      @close="syncing = null"
      @completed="imported"
    />
  </div>
</template>
