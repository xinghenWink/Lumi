<script setup lang="ts">
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
defineProps<{ admin?: boolean }>()
const emit = defineEmits<{ apply: [URLSearchParams] }>(),
  { t } = useI18n()
const values = reactive({ state: '', quality: '', from: '', until: '', user: '' })
function apply() {
  const q = new URLSearchParams({ limit: '40' })
  for (const key of ['state', 'quality'] as const) if (values[key]) q.set(key, values[key])
  if (values.from) q.set('from', new Date(values.from + 'T00:00:00Z').toISOString())
  if (values.until) {
    const date = new Date(values.until + 'T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + 1)
    q.set('until', date.toISOString())
  }
  if (values.user.trim()) q.set('user_id', values.user.trim())
  emit('apply', q)
}
</script>
<template>
  <form class="image-filters" @submit.prevent="apply">
    <label v-if="admin" class="field"
      >{{ t('images.user')
      }}<input
        v-model="values.user"
        maxlength="36"
        pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    /></label>
    <label class="field"
      >{{ t('images.quality')
      }}<select v-model="values.quality" :aria-label="t('images.quality')">
        <option value="">{{ t('images.all') }}</option>
        <option v-for="quality in ['low', 'medium', 'high']" :key="quality" :value="quality">
          {{ t('images.' + quality) }}
        </option>
      </select></label
    >
    <label class="field"
      >{{ t('images.status')
      }}<select v-model="values.state" :aria-label="t('images.status')">
        <option value="">{{ t('images.all') }}</option>
        <option
          v-for="status in ['queued', 'running', 'succeeded', 'partial', 'failed', 'canceled']"
          :key="status"
          :value="status"
        >
          {{ t('images.' + status) }}
        </option>
      </select></label
    >
    <label class="field"
      >{{ t('images.from')
      }}<input v-model="values.from" type="date" :max="values.until || undefined" /></label
    ><label class="field"
      >{{ t('images.until')
      }}<input v-model="values.until" type="date" :min="values.from || undefined"
    /></label>
    <button class="button">{{ t('images.filter') }}</button>
  </form>
</template>
