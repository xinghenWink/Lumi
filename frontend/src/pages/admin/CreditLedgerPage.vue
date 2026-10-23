<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import CreditLedgerTable from '../../components/credits/CreditLedgerTable.vue'
const { t } = useI18n()
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('credits.ledger') }}</h1>
      </div>
    </div>
    <CreditLedgerTable admin />
  </div>
</template>
