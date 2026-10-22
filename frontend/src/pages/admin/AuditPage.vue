<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-vue-next'
import { accounts } from '../../api/accounts'
import type { AuditPage } from '../../api/contracts'
import { addDateRange } from '../../features/accounts/utils'
import { useTime } from '../../features/accounts/time'
import ApiNotice from '../../components/ApiNotice.vue'
const { t, te } = useI18n()
const formatTime = useTime()
const filters = reactive({
  action: '',
  actor: '',
  targetType: '',
  targetId: '',
  from: '',
  until: '',
})
const actions = [
  'user.create',
  'user.update',
  'user.delete',
  'user.purge',
  'settings.update',
  'auth.register',
  'auth.login',
  'auth.logout',
  'auth.refresh_replay',
  'profile.update',
  'profile.password_change',
  'admin.bootstrap',
  'admin.password_reset_cli',
  'credits.adjust',
  'credits.initialize',
  'credits.pricing_update',
  'redeem.batch_create',
  'redeem.codes_update',
  'redeem.codes_delete',
  'credit_ledger.export',
  'redeem_code.export',
  'upstream.save',
  'upstream.delete',
  'upstream.test',
  'upstream.discover',
  'model.save',
  'model.delete',
  'model.import',
]
const page = shallowRef<AuditPage | null>(null)
const loading = ref(false)
const error = shallowRef<unknown>(null)
const cursors = ref([''])
const pageNumber = computed(() => cursors.value.length)
let controller: AbortController | null = null
let generation = 0
onMounted(() => void load())
onUnmounted(() => controller?.abort())
function actionName(action: string) {
  return te(`audit.actions.${action}`)
    ? t(`audit.actions.${action}`)
    : t('audit.otherAction', { action })
}
function targetName(target: string) {
  return te(`audit.types.${target}`) ? t(`audit.types.${target}`) : target
}
async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  try {
    const query = new URLSearchParams({
      action: filters.action,
      actor_id: filters.actor.trim(),
      target_type: filters.targetType,
      target_id: filters.targetId.trim(),
      cursor: cursors.value.at(-1) ?? '',
      limit: '20',
    })
    addDateRange(query, filters.from, filters.until)
    const result = await accounts.audit(query, controller.signal)
    if (current === generation) page.value = result
  } catch (failure) {
    if (
      current === generation &&
      !(failure instanceof DOMException && failure.name === 'AbortError')
    ) {
      error.value = failure
      page.value = null
    }
  } finally {
    if (current === generation) loading.value = false
  }
}
function search() {
  cursors.value = ['']
  void load()
}
function reset() {
  Object.assign(filters, {
    action: '',
    actor: '',
    targetType: '',
    targetId: '',
    from: '',
    until: '',
  })
  search()
}
function next() {
  if (page.value?.next_cursor) {
    cursors.value = [...cursors.value, page.value.next_cursor]
    void load()
  }
}
function previous() {
  if (cursors.value.length > 1) {
    cursors.value = cursors.value.slice(0, -1)
    void load()
  }
}
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('audit.title') }}</h1>
        <p>{{ t('audit.description') }}</p>
      </div>
    </div>
    <form class="filter-panel audit-filters" @submit.prevent="search">
      <select v-model="filters.action" :aria-label="t('audit.action')">
        <option value="">{{ t('audit.allActions') }}</option>
        <option v-for="action in actions" :key="action" :value="action">
          {{ actionName(action) }}
        </option></select
      ><input
        v-model="filters.actor"
        :aria-label="t('audit.actor')"
        :placeholder="t('audit.actorPlaceholder')"
        maxlength="36"
      /><select v-model="filters.targetType" :aria-label="t('audit.targetType')">
        <option value="">{{ t('audit.allTargets') }}</option>
        <option
          v-for="type in [
            'user',
            'site',
            'registration',
            'mail',
            'pricing',
            'redeem_batch',
            'redeem_code',
            'credit_ledger',
            'upstream',
            'model',
          ]"
          :key="type"
          :value="type"
        >
          {{ t(`audit.types.${type}`) }}
        </option></select
      ><input
        v-model="filters.targetId"
        :aria-label="t('audit.targetId')"
        :placeholder="t('audit.targetId')"
        maxlength="36"
      /><button class="button" type="submit">{{ t('common.search') }}</button>
      <div class="date-filters">
        <label>{{ t('common.from') }}<input v-model="filters.from" type="date" /></label
        ><label>{{ t('common.until') }}<input v-model="filters.until" type="date" /></label
        ><span class="field-hint">{{ t('common.filterUTC') }}</span
        ><button class="text-button" type="button" @click="reset">{{ t('common.reset') }}</button>
      </div>
    </form>
    <ApiNotice :error="error" />
    <div class="panel data-panel" :aria-busy="loading">
      <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="empty-state">
        <button class="button" @click="load">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!page?.items.length" class="empty-state">
        <ClipboardList :size="30" />
        <h2>{{ t('audit.emptyTitle') }}</h2>
        <p>{{ t('audit.emptyDescription') }}</p>
      </div>
      <div v-else class="audit-records">
        <article v-for="item in page.items" :key="item.id" class="audit-record">
          <div class="audit-record-header">
            <strong>{{ actionName(item.action) }}</strong
            ><span>{{ formatTime(item.created_at) }}</span>
          </div>
          <dl class="audit-meta">
            <div>
              <dt>{{ t('audit.actor') }}</dt>
              <dd>
                <RouterLink
                  v-if="item.actor_id"
                  :to="`/admin/users/${item.actor_id}`"
                  class="code-link"
                  >{{ item.actor_id }}</RouterLink
                ><span v-else>{{ t('audit.system') }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ t('audit.target') }}</dt>
              <dd>
                {{ targetName(item.target_type)
                }}<code v-if="item.target_id">{{ item.target_id }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ t('audit.ip') }}</dt>
              <dd>{{ item.ip }}</dd>
            </div>
          </dl>
          <details class="audit-changes">
            <summary>{{ t('audit.changes') }}</summary>
            <div class="form-grid">
              <div>
                <h3>{{ t('audit.before') }}</h3>
                <pre>{{ JSON.stringify(item.before, null, 2) }}</pre>
              </div>
              <div>
                <h3>{{ t('audit.after') }}</h3>
                <pre>{{ JSON.stringify(item.after, null, 2) }}</pre>
              </div>
            </div>
          </details>
        </article>
      </div>
      <div v-if="page && !loading" class="pagination">
        <span>{{ t('common.page', { page: pageNumber }) }}</span>
        <div>
          <button class="button compact" :disabled="pageNumber === 1" @click="previous">
            <ChevronLeft :size="15" />{{ t('common.previous') }}</button
          ><button class="button compact" :disabled="!page.next_cursor" @click="next">
            {{ t('common.next') }}<ChevronRight :size="15" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
