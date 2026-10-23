<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { images, type ImageConfiguration } from '../../api/images'
import { ApiError } from '../../api/transport'
import ApiNotice from '../../components/ApiNotice.vue'
const { t } = useI18n(),
  config = ref<ImageConfiguration>(),
  error = shallowRef<unknown>(),
  busy = ref(false),
  notice = ref(''),
  sizes = ref(''),
  ratios = ref('')
const controller = new AbortController()
let alive = true
const fields = [
  ['max_n', 1, 4],
  ['max_references', 0, 4],
  ['max_upload_bytes', 1024, 10485760],
  ['per_user_concurrency', 1, 20],
  ['global_concurrency', 1, 20],
  ['timeout_seconds', 5, 600],
  ['queue_timeout_seconds', 60, 86400],
  ['retention_days', 0, 3650],
] as const
function assign(value: ImageConfiguration) {
  config.value = value
  sizes.value = value.sizes.join('\n')
  ratios.value = Object.entries(value.ratio_sizes)
    .map(([ratio, size]) => ratio + '=' + size)
    .join('\n')
}
async function load() {
  error.value = null
  try {
    const data = await images.options(true, controller.signal)
    if (alive) assign(data)
  } catch (e) {
    if (alive) error.value = e
  }
}
async function save() {
  if (!config.value) return
  busy.value = true
  error.value = null
  notice.value = ''
  try {
    const mapping: Record<string, string> = {}
    for (const line of ratios.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const parts = line.split('=')
      if (parts.length !== 2 || !parts[0] || !parts[1] || mapping[parts[0]])
        throw new ApiError('INVALID_INPUT')
      mapping[parts[0].trim()] = parts[1].trim()
    }
    const result = await images.saveOptions({
      ...config.value,
      sizes: sizes.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      ratio_sizes: mapping,
    })
    if (alive) {
      assign(result)
      notice.value = t('images.saved')
    }
  } catch (e) {
    if (alive) error.value = e
  } finally {
    if (alive) busy.value = false
  }
}
onMounted(() => void load())
onUnmounted(() => {
  alive = false
  controller.abort()
})
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('images.settingsTitle') }}</h1>
        <p>{{ t('images.settingsHint') }}</p>
      </div>
    </div>
    <ApiNotice :error="error" />
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <button v-if="!config" class="button" @click="load">{{ t('images.refresh') }}</button>
    <form v-else class="panel panel-body stack image-settings-panel" @submit.prevent="save">
      <div class="form-grid">
        <label v-for="[key, min, max] in fields" :key="key" class="field"
          >{{ t('images.' + key)
          }}<input
            v-model.number="config[key]"
            type="number"
            :min="min"
            :max="max"
            step="1"
            required
            :disabled="busy"
        /></label>
      </div>
      <label class="field"
        >{{ t('images.sizes')
        }}<textarea v-model="sizes" rows="5" :disabled="busy" required /></label
      ><label class="field"
        >{{ t('images.ratio_sizes') }}<textarea v-model="ratios" rows="7" :disabled="busy" /></label
      ><label class="checkbox-label"
        ><input v-model="config.split_requests" type="checkbox" :disabled="busy" />{{
          t('images.split_requests')
        }}</label
      ><label class="checkbox-label"
        ><input v-model="config.admin_can_view_content" type="checkbox" :disabled="busy" />{{
          t('images.admin_can_view_content')
        }}</label
      >
      <p class="field-hint">{{ t('images.contentWarning') }}</p>
      <div class="dialog-actions">
        <button class="button primary" :disabled="busy">
          {{ t(busy ? 'common.saving' : 'common.save') }}
        </button>
      </div>
    </form>
  </div>
</template>
