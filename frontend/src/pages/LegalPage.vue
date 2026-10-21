<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import BrandMark from '../components/BrandMark.vue'
import { useSiteStore } from '../stores/site'
const route = useRoute()
const { t } = useI18n()
const site = useSiteStore()
const privacy = computed(() => route.name === 'privacy')
const sections = computed(() =>
  privacy.value ? ['data', 'purpose', 'contact'] : ['service', 'account', 'content'],
)
</script>
<template>
  <main class="legal-page">
    <RouterLink to="/login" class="brand-lockup"
      ><BrandMark /><span class="brand-name">{{
        site.config?.site.name ?? t('app.name')
      }}</span></RouterLink
    >
    <h1>{{ t(privacy ? 'legal.privacyTitle' : 'legal.termsTitle') }}</h1>
    <p class="muted">{{ t('legal.updated') }}</p>
    <section v-for="section in sections" :key="section">
      <h2>{{ t(`legal.${section}Title`) }}</h2>
      <p>{{ t(`legal.${section}`) }}</p>
      <p v-if="section === 'contact' && site.config?.site.contact">
        {{ site.config.site.contact }}
      </p>
    </section>
    <RouterLink class="button" to="/login">{{ t('common.back') }}</RouterLink>
  </main>
</template>
