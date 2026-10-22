<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from 'reka-ui'
import { ChevronsUpDown, LogOut, Settings2, Shield, UserRound, Coins } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import ApiNotice from './ApiNotice.vue'
import UserAvatar from './UserAvatar.vue'
const { t } = useI18n()
const auth = useAuthStore()
const theme = useThemeStore()
const router = useRouter()
const busy = ref(false)
const error = shallowRef<unknown>(null)
async function logout() {
  busy.value = true
  error.value = null
  try {
    await auth.logout()
    await router.replace('/login')
  } catch (failure) {
    error.value = failure
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="account-anchor">
    <ApiNotice :error="error" />
    <DropdownMenuRoot>
      <DropdownMenuTrigger class="account-trigger" :aria-label="t('nav.userMenu')"
        ><UserAvatar /><span class="account-label"
          ><strong>{{ auth.user?.nickname }}</strong
          ><span>{{
            t(auth.user?.role === 'admin' ? 'admin.users.admin' : 'admin.users.user')
          }}</span></span
        ><ChevronsUpDown :size="15"
      /></DropdownMenuTrigger>
      <DropdownMenuPortal
        ><DropdownMenuContent
          class="account-menu"
          side="top"
          align="start"
          :side-offset="10"
          :collision-padding="12"
        >
          <div class="account-email">{{ auth.user?.email }}</div>
          <DropdownMenuSeparator class="menu-separator" />
          <DropdownMenuItem class="menu-item" @select="router.push('/me')"
            ><UserRound :size="16" />{{ t('nav.account') }}</DropdownMenuItem
          >
          <DropdownMenuItem
            v-if="auth.user?.role === 'admin'"
            class="menu-item"
            @select="router.push('/admin')"
            ><Shield :size="16" />{{ t('nav.admin') }}</DropdownMenuItem
          >
          <DropdownMenuItem class="menu-item" @select="router.push('/me/credits')"
            ><Coins :size="16" />{{ t('nav.credits') }}</DropdownMenuItem
          >
          <DropdownMenuItem class="menu-item" @select="theme.toggle"
            ><Settings2 :size="16" />{{
              t(theme.current === 'light' ? 'common.themeDark' : 'common.themeLight')
            }}</DropdownMenuItem
          >
          <DropdownMenuSeparator class="menu-separator" /><DropdownMenuItem
            class="menu-item danger-text"
            :disabled="busy"
            @select="logout"
            ><LogOut :size="16" />{{
              t(busy ? 'auth.loggingOut' : 'auth.logout')
            }}</DropdownMenuItem
          >
        </DropdownMenuContent></DropdownMenuPortal
      >
    </DropdownMenuRoot>
  </div>
</template>
