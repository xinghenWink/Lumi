<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { images, type ImageTask } from '../../api/images'
import ImageFilters from '../../components/images/ImageFilters.vue'
import ImageTaskCard from '../../components/images/ImageTaskCard.vue'
import ModalDialog from '../../components/ModalDialog.vue'
import ApiNotice from '../../components/ApiNotice.vue'
import { useAuthStore } from '../../stores/auth'
const auth = useAuthStore()
const { t, te } = useI18n(),
  items = shallowRef<ImageTask[]>([]),
  selected = shallowRef<ImageTask>(),
  error = shallowRef<unknown>(),
  loading = ref(false),
  cursor = ref('')
let query = new URLSearchParams({ limit: '40' }),
  controller: AbortController | undefined
let alive = true,
  detailVersion = 0
async function load(more = false) {
  controller?.abort()
  const current = new AbortController()
  controller = current
  error.value = null
  loading.value = true
  if (!more) {
    items.value = []
    cursor.value = ''
  }
  try {
    const q = new URLSearchParams(query)
    if (more) q.set('cursor', cursor.value)
    const page = await images.tasks(q, true, current.signal)
    if (current.signal.aborted) return
    items.value = more ? [...items.value, ...page.items] : page.items
    cursor.value = page.next_cursor
  } catch (e) {
    if (!current.signal.aborted) error.value = e
  } finally {
    if (!current.signal.aborted) loading.value = false
  }
}
async function detail(row: ImageTask) {
  error.value = null
  const owner = auth.user?.id,
    version = ++detailVersion
  try {
    const result = await images.task(row.id, true)
    if (alive && owner === auth.user?.id && version === detailVersion) selected.value = result
  } catch (e) {
    if (alive && owner === auth.user?.id && version === detailVersion) error.value = e
  }
}
function apply(q: URLSearchParams) {
  query = q
  void load()
}
onMounted(() => void load())
watch(
  () => auth.user?.id,
  () => {
    detailVersion++
    controller?.abort()
    items.value = []
    selected.value = undefined
    error.value = null
  },
)
onUnmounted(() => {
  alive = false
  detailVersion++
  controller?.abort()
})
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('images.adminTitle') }}</h1>
        <p>{{ t('images.adminHint') }}</p>
      </div>
      <button class="button" :disabled="loading" @click="load()">{{ t('images.refresh') }}</button>
    </div>
    <ImageFilters admin @apply="apply" /><ApiNotice :error="error" />
    <div class="table-scroll panel">
      <table>
        <thead>
          <tr>
            <th>{{ t('images.task') }}</th>
            <th>{{ t('images.user') }}</th>
            <th>{{ t('images.model') }}</th>
            <th>{{ t('images.status') }}</th>
            <th>{{ t('images.count') }}</th>
            <th>{{ t('images.quality') }}</th>
            <th>{{ t('images.cost') }}</th>
            <th>{{ t('images.elapsed') }}</th>
            <th>{{ t('images.error') }}</th>
            <th>{{ t('images.created') }}</th>
            <th>{{ t('images.details') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in items" :key="task.id">
            <td class="mono">{{ task.id }}</td>
            <td class="mono">{{ task.user_id }}</td>
            <td>{{ task.model_name }}</td>
            <td>{{ t('images.' + task.status) }}</td>
            <td>{{ task.successful_images }} / {{ task.n }}</td>
            <td>{{ t('images.' + task.quality) }}</td>
            <td>{{ task.actual_cost }} / {{ task.refunded_cost }}</td>
            <td>
              {{
                task.started_at && task.finished_at
                  ? Math.max(
                      0,
                      (Date.parse(task.finished_at) - Date.parse(task.started_at)) / 1000,
                    ).toFixed(1)
                  : '—'
              }}
            </td>
            <td>
              {{
                task.error_code
                  ? t(
                      te('errors.' + task.error_code)
                        ? 'errors.' + task.error_code
                        : 'errors.UNKNOWN_ERROR',
                    )
                  : '—'
              }}
            </td>
            <td>{{ new Date(task.created_at).toLocaleString() }}</td>
            <td>
              <button class="text-button" @click="detail(task)">{{ t('images.details') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="loading" class="loading-state" role="status">{{ t('images.loading') }}</p>
    <button v-if="cursor" class="button" :disabled="loading" @click="load(true)">
      {{ t('images.more') }}
    </button>
    <ModalDialog
      :open="!!selected"
      :title="t('images.details')"
      :description="t('images.adminHint')"
      wide
      @update:open="selected = undefined"
      ><ImageTaskCard v-if="selected" :task="selected" admin @changed="detail(selected!)"
    /></ModalDialog>
  </div>
</template>
