<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CreditOverview from '../components/credits/CreditOverview.vue'
import CreditLedgerTable from '../components/credits/CreditLedgerTable.vue'
import CreditUsage from '../components/credits/CreditUsage.vue'
import RedemptionRecords from '../components/credits/RedemptionRecords.vue'
const { t } = useI18n()
const tab = ref('ledger'),
  revision = ref(0)
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('credits.title') }}</h1>
        <p>{{ t('credits.description') }}</p>
      </div>
    </div>
    <div class="credit-summary-grid">
      <CreditOverview @changed="revision++" /><CreditUsage :refresh-token="revision" />
    </div>
    <nav class="credit-tabs" :aria-label="t('credits.title')">
      <button
        v-for="item in ['ledger', 'records']"
        :key="item"
        :class="{ active: tab === item }"
        :aria-current="tab === item ? 'page' : undefined"
        @click="tab = item"
      >
        {{ t(`credits.${item}`) }}
      </button>
    </nav>
    <CreditLedgerTable v-if="tab === 'ledger'" :refresh-token="revision" /><RedemptionRecords
      v-else
      :refresh-token="revision"
    />
  </div>
</template>
