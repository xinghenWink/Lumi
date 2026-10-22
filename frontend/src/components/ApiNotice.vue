<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle } from 'lucide-vue-next'
import { ApiError } from '../api/transport'

const props = defineProps<{ error: unknown }>()
const { t, te } = useI18n()
const message = computed(() =>
  props.error instanceof ApiError && te(`errors.${props.error.code}`)
    ? t(`errors.${props.error.code}`)
    : t('errors.UNKNOWN_ERROR'),
)
const requestId = computed(() => (props.error instanceof ApiError ? props.error.requestId : ''))
const retryAfter = computed(() => (props.error instanceof ApiError ? props.error.retryAfter : 0))
</script>

<template>
  <div v-if="error" class="api-notice" role="alert">
    <AlertCircle :size="17" aria-hidden="true" />
    <div>
      {{ message
      }}<span v-if="retryAfter" class="request-reference">{{
        t('credits.retryAfter', { seconds: retryAfter })
      }}</span
      ><span v-if="requestId" class="request-reference"
        >{{ t('common.requestId') }} {{ requestId }}</span
      >
    </div>
  </div>
</template>
