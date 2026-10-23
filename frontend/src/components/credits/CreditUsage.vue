<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { credits } from '../../api/credits'
import { useCursorPage } from '../../features/credits/resources'
import ApiNotice from '../ApiNotice.vue'
const props = defineProps<{ refreshToken?: number }>()
const { t } = useI18n()
const { data, loading, error, load, reset } = useCursorPage(async (_, signal) => ({
  next_cursor: '',
  usage: await credits.usage(signal),
}))
const usage = computed(() => data.value?.usage ?? null)
const maximum = computed(() => Math.max(1, ...(usage.value?.days.map((day) => day.consumed) ?? [])))
const empty = computed(() => !usage.value?.days.some((day) => day.consumed > 0))
watch(
  () => props.refreshToken,
  () => void reset(),
)
</script>
<template>
  <section class="panel credit-usage" :aria-busy="loading">
    <div class="section-heading">
      <h2>{{ t('credits.usage') }}</h2>
    </div>
    <ApiNotice :error="error" /><button v-if="error" class="button" @click="load">
      {{ t('common.retry') }}
    </button>
    <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
    <template v-if="usage">
      <div class="usage-summary">
        <div>
          <span>{{ t('credits.monthConsumed') }}</span
          ><strong>{{ usage.month_consumed.toLocaleString() }}</strong>
        </div>
        <div>
          <span>{{ t('credits.successfulImages') }}</span>
          <div class="quality-totals">
            <span v-for="quality in ['low', 'medium', 'high'] as const" :key="quality"
              >{{ t(`credits.${quality}`)
              }}<strong>{{ usage.images_by_quality[quality].toLocaleString() }}</strong></span
            >
          </div>
        </div>
      </div>
      <figure class="usage-chart">
        <figcaption>{{ t('credits.days30') }}</figcaption>
        <ol class="usage-bars" :aria-label="t('credits.chartLabel')">
          <li
            v-for="day in usage.days"
            :key="day.date"
            :title="t('credits.chartDay', { date: day.date, amount: day.consumed })"
            :aria-label="t('credits.chartDay', { date: day.date, amount: day.consumed })"
          >
            <span
              :class="{ 'zero-usage': day.consumed === 0 }"
              :style="{ height: `${(day.consumed / maximum) * 100}%` }"
            />
          </li>
        </ol>
        <div class="chart-axis">
          <span>{{ usage.days[0]?.date }}</span
          ><span>{{ usage.days.at(-1)?.date }}</span>
        </div>
      </figure>
      <p v-if="empty" class="field-hint">{{ t('credits.noUsage') }}</p>
      <p class="field-hint">
        {{ t('credits.usageHint') }} {{ t('credits.timezone', { zone: usage.timezone }) }}
      </p>
    </template>
  </section>
</template>
