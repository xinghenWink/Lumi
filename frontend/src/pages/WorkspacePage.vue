<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, Check, Sparkles } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import ModelPicker from '../components/catalog/ModelPicker.vue'
const { t } = useI18n()
const auth = useAuthStore()
const route = useRoute()
const kind = computed(() => (route.path.startsWith('/create') ? 'image' : 'chat'))
</script>
<template>
  <div class="catalog-workspace">
    <nav class="catalog-mode-tabs" :aria-label="t('catalog.mode')">
      <RouterLink to="/chat">{{ t('catalog.chatMode') }}</RouterLink
      ><RouterLink to="/create">{{ t('catalog.imageMode') }}</RouterLink>
    </nav>
    <section class="workspace-welcome">
      <div class="workspace-emblem"><Sparkles :size="30" :stroke-width="1.5" /></div>
      <span class="eyebrow">{{
        t('workspace.greeting', { name: auth.user?.nickname ?? '' })
      }}</span>
      <h1>{{ t('workspace.title') }}</h1>
      <p>{{ t('workspace.description') }}</p>
      <div class="workspace-actions">
        <RouterLink class="button primary" to="/me"
          >{{ t('workspace.profile') }}<ArrowUpRight :size="17" /></RouterLink
        ><RouterLink v-if="auth.user?.role === 'admin'" class="button" to="/admin/users">{{
          t('nav.admin')
        }}</RouterLink>
      </div>
      <div class="account-ready"><Check :size="14" />{{ t('workspace.accountReady') }}</div>
    </section>
    <div class="panel catalog-composer">
      <p class="field-hint">{{ t('catalog.creationComing') }}</p>
      <div class="catalog-composer-toolbar"><ModelPicker :kind="kind" /></div>
    </div>
  </div>
</template>
