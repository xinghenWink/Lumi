<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Plus, Search, Pin } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat'
import ConversationActions from './ConversationActions.vue'
import ApiNotice from '../ApiNotice.vue'
const emit = defineEmits<{ navigate: [] }>()
const { t } = useI18n(),
  route = useRoute(),
  chat = useChatStore()
const scroller = ref<HTMLDivElement>(),
  search = ref(chat.query)
const virtual = useVirtualizer(
  computed(() => ({
    count: chat.conversations.length,
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => 44,
    overscan: 6,
  })),
)
const rows = computed(() => virtual.value.getVirtualItems())
onMounted(() => {
  if (!chat.conversations.length) void chat.list()
})
function apply() {
  chat.query = search.value
  void chat.list()
}
</script>
<template>
  <section class="chat-sidebar">
    <RouterLink class="button chat-new" to="/chat" @click="emit('navigate')"
      ><Plus :size="16" />{{ t('chat.newChat') }}</RouterLink
    >
    <template v-if="!route.path.startsWith('/create')">
      <form class="chat-sidebar-search" @submit.prevent="apply">
        <Search :size="14" /><input
          v-model="search"
          type="search"
          :aria-label="t('chat.search')"
          :placeholder="t('chat.search')"
          maxlength="100"
        />
      </form>
      <ApiNotice :error="chat.listError" />
      <p v-if="!chat.loading && !chat.conversations.length" class="field-hint">
        {{ t('chat.empty') }}
      </p>
      <div ref="scroller" class="chat-sidebar-scroll">
        <div :style="{ height: virtual.getTotalSize() + 'px', position: 'relative' }">
          <div
            v-for="item in rows"
            :key="String(item.key)"
            class="chat-sidebar-row"
            :style="{ transform: 'translateY(' + item.start + 'px)' }"
          >
            <template v-if="chat.conversations[item.index]"
              ><RouterLink
                :to="'/chat/' + chat.conversations[item.index]!.id"
                :aria-label="
                  t('chat.open', {
                    name: chat.conversations[item.index]!.title || t('chat.untitled'),
                  })
                "
                @click="emit('navigate')"
                ><Pin v-if="chat.conversations[item.index]!.pinned" :size="12" /><span>{{
                  chat.conversations[item.index]!.title || t('chat.untitled')
                }}</span></RouterLink
              ><ConversationActions :row="chat.conversations[item.index]!"
            /></template>
          </div>
        </div>
        <button
          v-if="chat.cursor"
          class="text-button"
          :disabled="chat.loading"
          @click="chat.list(true)"
        >
          {{ t('chat.loadMore') }}
        </button>
      </div>
    </template>
  </section>
</template>
