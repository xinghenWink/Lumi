<script setup lang="ts">
import { reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download } from 'lucide-vue-next'
import { credits } from '../../api/credits'
import { useCursorPage } from '../../features/credits/resources'
import { addDateRange } from '../../features/accounts/utils'
import { useTime } from '../../features/accounts/time'
import ApiNotice from '../ApiNotice.vue'
import CursorControls from './CursorControls.vue'
const props = defineProps<{ admin?: boolean; userId?: string; refreshToken?: number }>()
const { t, locale } = useI18n(),
  formatTime = useTime()
const number = (value: number) => new Intl.NumberFormat(locale.value).format(value)
const filters = reactive({ type: '', from: '', until: '', userId: '' })
let applied = { ...filters }
const types = [
  'signup_bonus',
  'daily_grant',
  'daily_expire',
  'redeem',
  'admin_adjust',
  'image_charge',
  'image_refund',
]
function query(cursor = '') {
  const result = new URLSearchParams({ type: applied.type, cursor, limit: '20' })
  const owner = props.userId ?? applied.userId.trim()
  if (props.admin && owner) result.set('user_id', owner)
  addDateRange(result, applied.from, applied.until)
  return result
}
const { data, loading, error, pageNumber, load, reset, next, previous } = useCursorPage(
  (cursor, signal) => credits.ledger(query(cursor), !!props.admin, signal),
)
function search() {
  applied = { ...filters }
  return reset()
}
watch(
  () => [props.userId, props.refreshToken],
  () => void reset(),
)
const exporting = ref(false),
  exportError = shallowRef<unknown>(null)
async function exportCSV() {
  exporting.value = true
  exportError.value = null
  try {
    await credits.export('ledger', query())
  } catch (failure) {
    exportError.value = failure
  } finally {
    exporting.value = false
  }
}
</script>
<template>
  <section class="credit-section">
    <div class="section-heading">
      <h2>{{ t('credits.ledger') }}</h2>
      <button v-if="admin" class="button compact" :disabled="exporting" @click="exportCSV">
        <Download :size="15" />{{ t(exporting ? 'credits.exporting' : 'credits.export') }}
      </button>
    </div>
    <form class="credit-filters" @submit.prevent="search">
      <label v-if="admin && !userId" class="field"
        >{{ t('credits.userID') }}<input v-model="filters.userId" maxlength="36"
      /></label>
      <label class="field"
        >{{ t('credits.type')
        }}<select v-model="filters.type" :aria-label="t('credits.type')">
          <option value="">{{ t('credits.allTypes') }}</option>
          <option v-for="type in types" :key="type" :value="type">
            {{ t(`credits.types.${type}`) }}
          </option>
        </select></label
      >
      <label class="field">{{ t('common.from') }}<input v-model="filters.from" type="date" /></label
      ><label class="field"
        >{{ t('common.until') }}<input v-model="filters.until" type="date"
      /></label>
      <button class="button" :disabled="loading">{{ t('common.search') }}</button>
      <span class="field-hint">{{ t('common.filterUTC') }}</span>
    </form>
    <ApiNotice :error="error || exportError" />
    <div class="panel data-panel" :aria-busy="loading">
      <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="empty-state">
        <button class="button" @click="load">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!data?.items.length" class="empty-state">
        <h3>{{ t('credits.emptyLedger') }}</h3>
        <p>{{ t('credits.emptyLedgerHint') }}</p>
      </div>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ t('credits.time') }}</th>
              <th v-if="admin && !userId">{{ t('credits.userID') }}</th>
              <th>{{ t('credits.type') }}</th>
              <th>{{ t('credits.bucket') }}</th>
              <th>{{ t('credits.delta') }}</th>
              <th>{{ t('credits.balanceAfter') }}</th>
              <th>{{ t('credits.note') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.items" :key="row.id">
              <td class="nowrap">{{ formatTime(row.created_at) }}</td>
              <td v-if="admin && !userId">
                <code class="compact-id">{{ row.user_id }}</code>
              </td>
              <td>{{ t(`credits.types.${row.type}`) }}</td>
              <td>{{ t(`credits.${row.bucket}`) }}</td>
              <td class="numeric" :class="row.delta > 0 ? 'credit-positive' : 'danger-text'">
                {{ row.delta > 0 ? '+' : '' }}{{ number(row.delta) }}
              </td>
              <td class="numeric">
                <strong>{{ number(row.total_after) }}</strong
                ><span class="table-secondary">{{
                  t('credits.bucketAfter', { amount: number(row.bucket_balance_after) })
                }}</span>
              </td>
              <td class="credit-note">
                {{ row.note || '—'
                }}<code
                  v-if="row.ref_id"
                  class="table-secondary compact-id"
                  :title="t('credits.reference')"
                  >{{ row.ref_id }}</code
                >
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
  </section>
</template>
