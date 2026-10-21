<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '../stores/theme'
const theme = useThemeStore()
const { t } = useI18n()
</script>
<template>
  <button
    class="icon-button"
    :aria-label="t(theme.current === 'light' ? 'common.themeDark' : 'common.themeLight')"
    @click="theme.toggle"
  >
    <Moon v-if="theme.current === 'light'" :size="18" /><Sun v-else :size="18" />
  </button>
</template>
