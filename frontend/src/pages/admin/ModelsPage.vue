<script setup lang="ts">
import { reactive, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Pencil, Trash2, Boxes } from 'lucide-vue-next'
import { catalog } from '../../api/catalog'
import type { PlatformModel, ModelInput } from '../../api/catalog-contracts'
import { useCursorPage } from '../../features/credits/resources'
import ModelEditor from '../../components/catalog/ModelEditor.vue'
import ApiNotice from '../../components/ApiNotice.vue'
import ModalDialog from '../../components/ModalDialog.vue'
import CursorControls from '../../components/credits/CursorControls.vue'
const { t } = useI18n()
const filters = reactive({ search: '', state: '', type: '' })
let applied = { ...filters }
const { data, loading, error, load, reset, next, previous, pageNumber } = useCursorPage(
  (cursor, signal) =>
    catalog.models(new URLSearchParams({ ...applied, cursor, limit: '20' }), signal),
)
function search() {
  applied = { ...filters }
  void reset()
}
const selected = shallowRef<PlatformModel | null>(null),
  deleting = shallowRef<PlatformModel | null>(null)
const open = ref(false),
  busy = ref(false),
  notice = ref(''),
  actionError = shallowRef<unknown>(null),
  modalError = shallowRef<unknown>(null)
function edit(row?: PlatformModel) {
  selected.value = row ?? null
  open.value = true
}
async function saved() {
  open.value = false
  notice.value = t('catalog.modelSaved')
  await reset()
}
async function toggle(row: PlatformModel) {
  busy.value = true
  actionError.value = null
  const body: ModelInput = {
    version: row.version,
    display_name: row.display_name,
    type: row.type,
    description: row.description,
    icon: row.icon,
    sort_order: row.sort_order,
    enabled: !row.enabled,
    is_default: row.enabled ? false : row.is_default,
    capabilities: row.capabilities,
    routes: row.routes.map((route) => ({
      upstream_id: route.upstream_id,
      upstream_model_name: route.upstream_model_name,
      priority: route.priority,
      weight: route.weight,
      enabled: route.enabled,
    })),
  }
  try {
    await catalog.saveModel(body, row.id)
    notice.value = t('catalog.modelSaved')
    await load()
  } catch (failure) {
    actionError.value = failure
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!deleting.value) return
  busy.value = true
  modalError.value = null
  try {
    await catalog.deleteModel(deleting.value.id)
    deleting.value = null
    notice.value = t('catalog.modelDeleted')
    await reset()
  } catch (failure) {
    modalError.value = failure
  } finally {
    busy.value = false
  }
}
function openDelete(row: PlatformModel) {
  deleting.value = row
  modalError.value = null
}
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('catalog.modelsTitle') }}</h1>
        <p>{{ t('catalog.modelsDescription') }}</p>
      </div>
      <button class="button primary" @click="edit()">
        <Plus :size="16" />{{ t('catalog.newModel') }}
      </button>
    </div>
    <form class="filter-panel catalog-filters" @submit.prevent="search">
      <input
        v-model="filters.search"
        type="search"
        :aria-label="t('catalog.searchModels')"
        :placeholder="t('catalog.searchModels')"
        maxlength="100"
      /><select v-model="filters.type" :aria-label="t('catalog.type')">
        <option value="">{{ t('catalog.allTypes') }}</option>
        <option value="chat">{{ t('catalog.chat') }}</option>
        <option value="image">{{ t('catalog.image') }}</option></select
      ><select v-model="filters.state" :aria-label="t('catalog.allStates')">
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
        <Boxes :size="30" />
        <h2>{{ t('catalog.noModels') }}</h2>
        <p>{{ t('catalog.noModelsHint') }}</p>
      </div>
      <div v-else class="table-scroll">
        <table class="catalog-model-table">
          <thead>
            <tr>
              <th>{{ t('catalog.modelName') }}</th>
              <th>{{ t('catalog.type') }}</th>
              <th>{{ t('catalog.enabled') }}</th>
              <th>{{ t('catalog.routes') }}</th>
              <th>{{ t('catalog.sortOrder') }}</th>
              <th>{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.items" :key="row.id">
              <td>
                <strong>{{ row.display_name }}</strong
                ><span v-if="row.is_default" class="badge purple">{{
                  t('catalog.defaultState')
                }}</span
                ><code class="table-secondary compact-id">{{ row.id }}</code
                ><span v-if="row.description" class="table-secondary">{{ row.description }}</span>
              </td>
              <td>{{ t('catalog.' + row.type) }}</td>
              <td>
                <span class="badge" :class="row.enabled ? 'green' : 'red'">{{
                  t(row.enabled ? 'catalog.enabledState' : 'catalog.disabledState')
                }}</span>
              </td>
              <td>
                <div class="catalog-route-summary">
                  <span
                    v-for="route in row.routes"
                    :key="route.id"
                    :class="{ 'muted-route': !route.enabled || !route.upstream_enabled }"
                    ><span class="status-dot" />{{ route.upstream_name
                    }}<code>{{ route.upstream_model_name }}</code></span
                  ><span v-if="!row.routes.length" class="field-hint">{{
                    t('catalog.noRoutes')
                  }}</span>
                </div>
              </td>
              <td class="numeric">{{ row.sort_order }}</td>
              <td>
                <div class="row-actions">
                  <button
                    class="icon-button"
                    :aria-label="t('catalog.editModel') + ' ' + row.display_name"
                    @click="edit(row)"
                  >
                    <Pencil :size="16" /></button
                  ><button class="text-button" :disabled="busy" @click="toggle(row)">
                    {{ t(row.enabled ? 'credits.disable' : 'credits.enable') }}</button
                  ><button
                    class="icon-button danger-text"
                    :aria-label="t('catalog.deleteModel') + ' ' + row.display_name"
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
    <ModelEditor v-if="open" :model="selected" @close="open = false" @saved="saved" />
    <ModalDialog
      :open="!!deleting"
      :busy="busy"
      :title="t('catalog.deleteModel')"
      :description="t('catalog.deleteModelHint', { name: deleting?.display_name ?? '' })"
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
  </div>
</template>
