<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '../stores/theme'
import { useAuthStore } from '../stores/auth'
import { operations } from '../api/operations'
const theme = useThemeStore()
const auth = useAuthStore()
async function toggle() {
  theme.toggle()
  const id = auth.user?.id,
    value = theme.preference
  if (!id) return
  try {
    const pref = await operations.preferences()
    if (auth.user?.id === id) await operations.savePreferences({ ...pref, theme: value })
  } catch {
    /* Appearance remains available locally while the network is unavailable. */
  }
}
const { t } = useI18n()
</script>
<template>
  <button
    class="icon-button"
    :aria-label="t(theme.current === 'light' ? 'common.themeDark' : 'common.themeLight')"
    @click="toggle"
  >
    <Moon v-if="theme.current === 'light'" :size="18" /><Sun v-else :size="18" />
  </button>
</template>
