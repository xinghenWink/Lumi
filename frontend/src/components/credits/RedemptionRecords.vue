<script setup lang="ts">
import { reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { credits } from '../../api/credits'
import { useCursorPage } from '../../features/credits/resources'
import { useTime } from '../../features/accounts/time'
import ApiNotice from '../ApiNotice.vue'
import CursorControls from './CursorControls.vue'
const props = defineProps<{
  admin?: boolean
  userId?: string
  codeId?: string
  refreshToken?: number
}>()
const { t } = useI18n(),
  formatTime = useTime()
const filters = reactive({ userId: '', codeId: props.codeId ?? '' })
let applied = { ...filters }
const { data, loading, error, pageNumber, load, reset, next, previous } = useCursorPage(
  (cursor, signal) => {
    const query = new URLSearchParams({ cursor, limit: '20' })
    const owner = props.userId ?? applied.userId.trim()
    if (props.admin && owner) query.set('user_id', owner)
    if (applied.codeId.trim()) query.set('code_id', applied.codeId.trim())
    return credits.records(query, !!props.admin, signal)
  },
)
function search() {
  applied = { ...filters }
  return reset()
}
watch(
  () => [props.userId, props.codeId, props.refreshToken],
  () => {
    if (props.codeId !== undefined) {
      filters.codeId = props.codeId
      applied.codeId = props.codeId
    }
    void reset()
  },
)
</script>
<template>
  <section class="credit-section">
    <div class="section-heading">
      <h2>{{ t('credits.records') }}</h2>
    </div>
    <form v-if="admin" class="credit-filters" @submit.prevent="search">
      <label v-if="!userId" class="field"
        >{{ t('credits.userID') }}<input v-model="filters.userId" maxlength="36"
      /></label>
      <label class="field"
        >{{ t('credits.codeID') }}<input v-model="filters.codeId" maxlength="36"
      /></label>
      <button class="button" :disabled="loading">{{ t('credits.filterRecords') }}</button>
    </form>
    <ApiNotice :error="error" />
    <div class="panel data-panel" :aria-busy="loading">
      <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="empty-state">
        <button class="button" @click="load">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!data?.items.length" class="empty-state">
        <h3>{{ t('credits.emptyRecords') }}</h3>
        <p>{{ t('credits.emptyRecordsHint') }}</p>
      </div>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ t('credits.time') }}</th>
              <th v-if="admin && !userId">{{ t('credits.userID') }}</th>
              <th>{{ t('credits.tail') }}</th>
              <th>{{ t('credits.gained') }}</th>
              <th v-if="admin">{{ t('audit.ip') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.items" :key="row.id">
              <td class="nowrap">{{ formatTime(row.created_at) }}</td>
              <td v-if="admin && !userId">
                <code class="compact-id">{{ row.user_id }}</code>
              </td>
              <td>
                <code>···· {{ row.code_tail }}</code>
              </td>
              <td class="numeric credit-positive">+{{ row.credits.toLocaleString() }}</td>
              <td v-if="admin">{{ row.ip }}</td>
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
