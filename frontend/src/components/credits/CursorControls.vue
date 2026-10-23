<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
defineProps<{ page: number; nextCursor: string; loading: boolean }>()
const emit = defineEmits<{ previous: []; next: [] }>()
const { t } = useI18n()
</script>
<template>
  <div class="pagination">
    <span>{{ t('common.page', { page }) }}</span>
    <div>
      <button class="button compact" :disabled="page === 1 || loading" @click="emit('previous')">
        <ChevronLeft :size="15" />{{ t('common.previous') }}
      </button>
      <button class="button compact" :disabled="!nextCursor || loading" @click="emit('next')">
        {{ t('common.next') }}<ChevronRight :size="15" />
      </button>
    </div>
  </div>
</template>
