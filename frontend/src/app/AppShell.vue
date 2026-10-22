<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'
import { Menu, X } from 'lucide-vue-next'
import AppSidebar from '../components/AppSidebar.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useSiteStore } from '../stores/site'
const route = useRoute()
const { t } = useI18n()
const site = useSiteStore()
const admin = computed(() => route.path.startsWith('/admin'))
const menuOpen = ref(false)
const title = computed(() =>
  t(typeof route.meta.title === 'string' ? route.meta.title : 'nav.workspace'),
)
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  },
)
onMounted(() => {
  if (!site.config) void site.load()
})
</script>
<template>
  <div class="app-layout" :class="{ 'admin-layout': admin }">
    <a href="#main-content" class="skip-link">{{ t('app.skipLink') }}</a>
    <aside class="desktop-sidebar"><AppSidebar :admin="admin" /></aside>
    <DialogRoot v-model:open="menuOpen"
      ><DialogPortal
        ><DialogOverlay class="dialog-overlay" /><DialogContent class="mobile-sidebar"
          ><DialogTitle class="sr-only">{{ t('nav.workspace') }}</DialogTitle
          ><DialogDescription class="sr-only">{{ t('nav.openMenu') }}</DialogDescription
          ><DialogClose class="icon-button drawer-close" :aria-label="t('nav.closeMenu')"
            ><X :size="19" /></DialogClose
          ><AppSidebar :admin="admin" @navigate="menuOpen = false" /></DialogContent></DialogPortal
    ></DialogRoot>
    <div class="app-main">
      <header class="app-topbar">
        <button
          class="icon-button mobile-menu-button"
          :aria-label="t('nav.openMenu')"
          @click="menuOpen = true"
        >
          <Menu :size="21" /></button
        ><span>{{ title }}</span>
        <div class="topbar-spacer" />
        <ThemeToggle />
      </header>
      <main id="main-content" class="app-content"><RouterView /></main>
    </div>
  </div>
</template>
