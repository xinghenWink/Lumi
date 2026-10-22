<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { watchEffect, watch, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import { useSiteStore } from '../stores/site'

const { t, locale } = useI18n()
const auth = useAuthStore()
const theme = useThemeStore()
const site = useSiteStore()
const route = useRoute()
const router = useRouter()
theme.initialize()
const media = window.matchMedia('(prefers-color-scheme: dark)')
theme.systemDark = media.matches
function systemTheme(event: MediaQueryListEvent) {
  theme.systemDark = event.matches
}
media.addEventListener('change', systemTheme)
onUnmounted(() => media.removeEventListener('change', systemTheme))
watch(
  () => auth.user?.locale,
  (value) => {
    if (value) locale.value = value
  },
)
watch(
  () => auth.user,
  (value) => {
    if (auth.initialized && !value && route.meta.requiresAuth)
      void router.replace({ name: 'login', query: { redirect: route.fullPath } })
  },
)
watchEffect(() => {
  document.documentElement.lang = locale.value
  document.documentElement.dataset.theme = theme.current
  document.title = `${site.config?.site.name ?? t('app.name')} · ${t(typeof route.meta.title === 'string' ? route.meta.title : 'app.tagline')}`
})
</script>

<template>
  <RouterView />
</template>
