<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'

const { t } = useI18n()
</script>

<template>
  <main class="not-found">
    <BrandMark />
    <h1>{{ t('notFound.title') }}</h1>
    <p>{{ t('notFound.description') }}</p>
    <RouterLink class="refresh-button" to="/">{{ t('notFound.home') }}</RouterLink>
  </main>
</template>
