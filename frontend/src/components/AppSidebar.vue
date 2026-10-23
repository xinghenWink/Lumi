<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  ClipboardList,
  Image,
  MessageSquare,
  Settings2,
  Users,
  Coins,
  Ticket,
  SlidersHorizontal,
  Server,
  Boxes,
} from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import AccountMenu from './AccountMenu.vue'
import ChatSidebar from './chat/ChatSidebar.vue'
import { useSiteStore } from '../stores/site'
import { useImageStore } from '../stores/images'
const ImageSidebar = defineAsyncComponent(() => import('./images/ImageSidebar.vue'))
const route = useRoute(),
  images = useImageStore()
const props = defineProps<{ admin: boolean }>()
const emit = defineEmits<{ navigate: [] }>()
const { t } = useI18n()
const site = useSiteStore()
const links = computed(() =>
  props.admin
    ? [
        { path: '/admin/users', key: 'nav.users', icon: Users },
        { path: '/admin/upstreams', key: 'nav.upstreams', icon: Server },
        { path: '/admin/models', key: 'nav.models', icon: Boxes },
        { path: '/admin/chat-settings', key: 'nav.chatSettings', icon: MessageSquare },
        { path: '/admin/image-tasks', key: 'nav.imageTasks', icon: Image },
        { path: '/admin/image-settings', key: 'nav.imageSettings', icon: Settings2 },
        { path: '/admin/pricing', key: 'nav.pricing', icon: SlidersHorizontal },
        { path: '/admin/redeem-codes', key: 'nav.redeemCodes', icon: Ticket },
        { path: '/admin/credit-ledger', key: 'nav.creditLedger', icon: Coins },
        { path: '/admin/settings', key: 'nav.settings', icon: Settings2 },
        { path: '/admin/audit', key: 'nav.audit', icon: ClipboardList },
      ]
    : [
        { path: '/chat', key: 'nav.chat', icon: MessageSquare },
        { path: '/me/credits', key: 'nav.credits', icon: Coins },
        { path: '/me/chats', key: 'nav.chatHistory', icon: MessageSquare },
        { path: '/me/images', key: 'nav.gallery', icon: Image },
      ],
)
</script>
<template>
  <div class="sidebar-content">
    <RouterLink to="/chat" class="sidebar-brand brand-lockup" @click="emit('navigate')"
      ><BrandMark />
      <div>
        <span class="brand-name">{{ site.config?.site.name ?? t('app.name') }}</span
        ><span class="brand-caption">{{ t(admin ? 'nav.administration' : 'nav.workspace') }}</span>
      </div></RouterLink
    >
    <nav class="sidebar-navigation" :aria-label="t(admin ? 'nav.admin' : 'nav.workspace')">
      <RouterLink
        v-for="link in links"
        :key="link.path"
        :to="link.path"
        class="sidebar-link"
        @click="emit('navigate')"
        ><component :is="link.icon" :size="18" />{{ t(link.key) }}</RouterLink
      >
      <RouterLink
        v-if="!admin"
        :to="images.lastOpened ? '/create/' + images.lastOpened : '/create'"
        class="sidebar-link"
        @click="emit('navigate')"
      >
        <Image :size="18" />{{ t('nav.image') }}
      </RouterLink>
    </nav>
    <ImageSidebar v-if="!admin && route.path.startsWith('/create')" @navigate="emit('navigate')" />
    <ChatSidebar v-else-if="!admin" @navigate="emit('navigate')" />
    <div v-else class="sidebar-spacer" />
    <RouterLink
      v-if="admin"
      class="sidebar-link back-workspace"
      to="/chat"
      @click="emit('navigate')"
      ><ArrowLeft :size="16" />{{ t('nav.backWorkspace') }}</RouterLink
    >
    <AccountMenu />
  </div>
</template>
