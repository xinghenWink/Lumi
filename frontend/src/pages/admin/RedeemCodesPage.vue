<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Copy, Download, Trash2 } from 'lucide-vue-next'
import { credits } from '../../api/credits'
import type { RedeemBatch, RedeemBatchInput, RedeemCode } from '../../api/credit-contracts'
import { useCursorPage, useMutationKey } from '../../features/credits/resources'
import { useTime } from '../../features/accounts/time'
import ApiNotice from '../../components/ApiNotice.vue'
import ModalDialog from '../../components/ModalDialog.vue'
import CursorControls from '../../components/credits/CursorControls.vue'
import RedemptionRecords from '../../components/credits/RedemptionRecords.vue'
const { t } = useI18n(),
  formatTime = useTime()
const tab = ref('codes'),
  recordCode = ref(''),
  revision = ref(0)
const filters = reactive({ batchId: '', status: '', search: '' })
let applied = { ...filters }
function query(cursor = '') {
  return new URLSearchParams({
    batch_id: applied.batchId,
    status: applied.status,
    search: applied.search.trim(),
    limit: '20',
    cursor,
  })
}
const { data, loading, error, pageNumber, load, reset, next, previous } = useCursorPage(
  (cursor, signal) => credits.codes(query(cursor), signal),
)
function search() {
  applied = { ...filters }
  return reset()
}
const batches = shallowRef<RedeemBatch[]>([]),
  batchCursor = ref(''),
  batchLoading = ref(false)
const actionError = shallowRef<unknown>(null),
  notice = ref(''),
  busy = ref(false),
  exporting = ref(false)
const selected = shallowRef(new Set<string>())
const allSelected = computed(
  () => !!data.value?.items.length && data.value.items.every((code) => selected.value.has(code.id)),
)
const open = ref(false),
  deleteOpen = ref(false),
  validation = ref('')
const form = reactive({
  name: '',
  note: '',
  prefix: 'LUMI',
  quantity: 100,
  credits: 10,
  maxUses: 1,
  expiresAt: '',
})
const mutation = useMutationKey()
let alive = true,
  batchController: AbortController | null = null
onMounted(() => void loadBatches())
onUnmounted(() => {
  alive = false
  batchController?.abort()
})
watch(data, () => {
  selected.value = new Set()
})
async function loadBatches(more = false) {
  if (batchLoading.value) return
  batchLoading.value = true
  batchController?.abort()
  batchController = new AbortController()
  try {
    const result = await credits.batches(
      new URLSearchParams({ limit: '100', cursor: more ? batchCursor.value : '' }),
      batchController.signal,
    )
    if (alive) {
      batches.value = more ? [...batches.value, ...result.items] : result.items
      batchCursor.value = result.next_cursor
    }
  } catch (failure) {
    if (alive && !(failure instanceof DOMException && failure.name === 'AbortError'))
      actionError.value = failure
  } finally {
    if (alive) batchLoading.value = false
  }
}
function select(id: string) {
  const value = new Set(selected.value)
  if (value.has(id)) value.delete(id)
  else value.add(id)
  selected.value = value
}
function selectAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set(data.value?.items.map((item) => item.id) ?? [])
}
function openBatch() {
  open.value = true
  validation.value = ''
  actionError.value = null
  notice.value = ''
}
function openDeletion() {
  deleteOpen.value = true
  actionError.value = null
}
async function generate() {
  if (busy.value) return
  validation.value = ''
  actionError.value = null
  if (
    !form.name.trim() ||
    !Number.isSafeInteger(Number(form.quantity)) ||
    !Number.isSafeInteger(Number(form.credits)) ||
    !Number.isSafeInteger(Number(form.maxUses))
  ) {
    validation.value = t('credits.invalid')
    return
  }
  let expires: string | null = null
  if (form.expiresAt) {
    const stamp = new Date(form.expiresAt)
    if (!Number.isFinite(stamp.getTime()) || stamp.getTime() <= Date.now()) {
      validation.value = t('credits.invalid')
      return
    }
    expires = stamp.toISOString()
  }
  const body: RedeemBatchInput = {
    name: form.name.trim(),
    note: form.note.trim(),
    prefix: form.prefix.trim(),
    quantity: Number(form.quantity),
    credits: Number(form.credits),
    max_uses: Number(form.maxUses),
    expires_at: expires,
  }
  busy.value = true
  try {
    const result = await credits.createBatch(body, mutation.forPayload(body))
    mutation.complete()
    if (!alive) return
    batches.value = [result, ...batches.value.filter((item) => item.id !== result.id)]
    filters.batchId = result.id
    open.value = false
    notice.value = t('credits.batchCreated', { count: result.quantity })
    form.name = ''
    await search()
  } catch (failure) {
    if (alive) actionError.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
async function toggle(ids: string[], enabled: boolean) {
  if (busy.value) return
  busy.value = true
  actionError.value = null
  notice.value = ''
  try {
    await credits.toggleCodes(ids, enabled)
    if (alive) {
      notice.value = t('credits.codesUpdated')
      await load()
    }
  } catch (failure) {
    if (alive) actionError.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
async function remove() {
  if (busy.value) return
  busy.value = true
  actionError.value = null
  notice.value = ''
  try {
    await credits.deleteCodes([...selected.value])
    if (alive) {
      deleteOpen.value = false
      notice.value = t('credits.codesDeleted')
      await reset()
    }
  } catch (failure) {
    if (alive) actionError.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
async function copy(code: RedeemCode) {
  try {
    await navigator.clipboard.writeText(code.code)
    notice.value = t('common.copied')
  } catch {
    notice.value = t('common.copyFailed')
  }
}
async function exportCSV() {
  if (exporting.value) return
  exporting.value = true
  actionError.value = null
  try {
    await credits.export('codes', query())
  } catch (failure) {
    if (alive) actionError.value = failure
  } finally {
    if (alive) exporting.value = false
  }
}
function viewRecords(code: RedeemCode) {
  recordCode.value = code.id
  tab.value = 'records'
  revision.value++
}
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('credits.codesTitle') }}</h1>
        <p>{{ t('credits.codesDescription') }}</p>
      </div>
      <button class="button primary" @click="openBatch">
        <Plus :size="16" />{{ t('credits.newBatch') }}
      </button>
    </div>
    <nav class="credit-tabs" :aria-label="t('credits.codesTitle')">
      <button
        :class="{ active: tab === 'codes' }"
        :aria-current="tab === 'codes' ? 'page' : undefined"
        @click="tab = 'codes'"
      >
        {{ t('credits.codesTitle') }}</button
      ><button
        :class="{ active: tab === 'records' }"
        :aria-current="tab === 'records' ? 'page' : undefined"
        @click="tab = 'records'"
      >
        {{ t('credits.records') }}
      </button>
    </nav>
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <ApiNotice v-if="!open && !deleteOpen" :error="actionError" />
    <template v-if="tab === 'codes'">
      <form class="credit-filters" @submit.prevent="search">
        <label class="field"
          >{{ t('credits.batch')
          }}<select v-model="filters.batchId">
            <option value="">{{ t('credits.allBatches') }}</option>
            <option v-for="batch in batches" :key="batch.id" :value="batch.id">
              {{ batch.name }} · {{ batch.quantity }}
            </option>
          </select></label
        >
        <button
          v-if="batchCursor"
          class="text-button"
          type="button"
          :disabled="batchLoading"
          @click="loadBatches(true)"
        >
          {{ t('credits.moreBatches') }}
        </button>
        <label class="field"
          >{{ t('credits.status')
          }}<select v-model="filters.status">
            <option value="">{{ t('credits.allStatuses') }}</option>
            <option
              v-for="status in ['unused', 'used', 'expired', 'disabled']"
              :key="status"
              :value="status"
            >
              {{ t(`credits.${status}`) }}
            </option>
          </select></label
        >
        <label class="field code-search"
          >{{ t('credits.exactCodeSearch') }}<input v-model="filters.search" maxlength="80"
        /></label>
        <button class="button" :disabled="loading">{{ t('common.search') }}</button>
        <button class="button" type="button" :disabled="exporting" @click="exportCSV">
          <Download :size="15" />{{ t(exporting ? 'credits.exporting' : 'credits.export') }}
        </button>
      </form>
      <div v-if="selected.size" class="selection-toolbar">
        <span>{{ t('credits.selected', { count: selected.size }) }}</span
        ><button class="button compact" :disabled="busy" @click="toggle([...selected], true)">
          {{ t('credits.enable') }}</button
        ><button class="button compact" :disabled="busy" @click="toggle([...selected], false)">
          {{ t('credits.disable') }}</button
        ><button class="button compact danger-text" :disabled="busy" @click="openDeletion">
          <Trash2 :size="15" />{{ t('credits.delete') }}
        </button>
      </div>
      <ApiNotice :error="error" />
      <div class="panel data-panel" :aria-busy="loading">
        <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
        <div v-else-if="error" class="empty-state">
          <button class="button" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-else-if="!data?.items.length" class="empty-state">
          <h2>{{ t('credits.noCodes') }}</h2>
          <p>{{ t('credits.noCodesHint') }}</p>
        </div>
        <div v-else class="table-scroll">
          <table class="redeem-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    :aria-label="t('credits.selectAll')"
                    :disabled="busy"
                    @change="selectAll"
                  />
                </th>
                <th>{{ t('credits.code') }}</th>
                <th>{{ t('credits.creditsPerCode') }}</th>
                <th>{{ t('credits.usedCount') }}</th>
                <th>{{ t('credits.status') }}</th>
                <th>{{ t('admin.users.expires') }}</th>
                <th>{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="code in data.items" :key="code.id">
                <td>
                  <input
                    type="checkbox"
                    :checked="selected.has(code.id)"
                    :aria-label="`${t('credits.select')} ${code.tail}`"
                    :disabled="busy"
                    @change="select(code.id)"
                  />
                </td>
                <td>
                  <div class="code-copy">
                    <code>{{ code.code }}</code
                    ><button
                      class="icon-button"
                      :aria-label="`${t('credits.clipboard')} ${code.tail}`"
                      @click="copy(code)"
                    >
                      <Copy :size="15" />
                    </button>
                  </div>
                </td>
                <td class="numeric">{{ code.credits.toLocaleString() }}</td>
                <td class="numeric">{{ code.used_count }} / {{ code.max_uses }}</td>
                <td>
                  <span
                    class="badge"
                    :class="
                      code.status === 'unused' ? 'green' : code.status === 'disabled' ? 'red' : ''
                    "
                    >{{ t(`credits.${code.status}`) }}</span
                  >
                </td>
                <td class="nowrap">
                  {{ code.expires_at ? formatTime(code.expires_at) : t('credits.neverExpires') }}
                </td>
                <td>
                  <div class="row-actions">
                    <button
                      class="text-button"
                      :disabled="busy"
                      @click="toggle([code.id], !code.enabled)"
                    >
                      {{ t(code.enabled ? 'credits.disable' : 'credits.enable') }}</button
                    ><button class="text-button" @click="viewRecords(code)">
                      {{ t('credits.viewRecords') }}
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
          @previous="previous"
          @next="next"
        />
      </div>
    </template>
    <RedemptionRecords v-else admin :code-id="recordCode" :refresh-token="revision" />
    <ModalDialog
      v-model:open="open"
      :busy="busy"
      :title="t('credits.newBatch')"
      :description="t('credits.batchDescription')"
    >
      <form class="stack" @submit.prevent="generate">
        <label class="field"
          >{{ t('credits.batchName')
          }}<input v-model="form.name" maxlength="80" required :disabled="busy"
        /></label>
        <div class="form-grid">
          <label class="field"
            >{{ t('credits.quantity')
            }}<input
              v-model.number="form.quantity"
              type="number"
              min="1"
              max="1000"
              step="1"
              required
              :disabled="busy" /></label
          ><label class="field"
            >{{ t('credits.creditsPerCode')
            }}<input
              v-model.number="form.credits"
              type="number"
              min="1"
              max="1000000000"
              step="1"
              required
              :disabled="busy"
          /></label>
          <label class="field"
            >{{ t('credits.prefix')
            }}<input
              v-model="form.prefix"
              maxlength="12"
              pattern="[A-Za-z0-9]*"
              :disabled="busy" /></label
          ><label class="field"
            >{{ t('credits.maxUses')
            }}<input
              v-model.number="form.maxUses"
              type="number"
              min="1"
              max="1000000"
              step="1"
              required
              :disabled="busy"
          /></label>
        </div>
        <p class="field-hint">{{ t('credits.maxUsesHint') }}</p>
        <label class="field"
          >{{ t('credits.expiresAt')
          }}<input v-model="form.expiresAt" type="datetime-local" :disabled="busy"
        /></label>
        <label class="field"
          >{{ t('credits.batchNote')
          }}<textarea v-model="form.note" maxlength="200" rows="2" :disabled="busy" />
        </label>
        <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
        <ApiNotice :error="actionError" />
        <div class="dialog-actions">
          <button class="button" type="button" :disabled="busy" @click="open = false">
            {{ t('common.cancel') }}</button
          ><button class="button primary" :disabled="busy">
            {{ t(busy ? 'common.saving' : 'credits.createBatch') }}
          </button>
        </div>
      </form>
    </ModalDialog>
    <ModalDialog
      v-model:open="deleteOpen"
      :busy="busy"
      :title="t('credits.deleteTitle')"
      :description="t('credits.deleteDescription', { count: selected.size })"
    >
      <ApiNotice :error="actionError" />
      <div class="dialog-actions">
        <button class="button" :disabled="busy" @click="deleteOpen = false">
          {{ t('common.cancel') }}</button
        ><button class="button danger" :disabled="busy || !selected.size" @click="remove">
          {{ t('credits.deleteAction') }}
        </button>
      </div>
    </ModalDialog>
  </div>
</template>
