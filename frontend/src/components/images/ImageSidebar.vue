<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Plus, Search, Pin, MoreHorizontal } from 'lucide-vue-next'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui'
import { useImageStore } from '../../stores/images'
import type { ImageConversation } from '../../api/images'
import ModalDialog from '../ModalDialog.vue'
import ApiNotice from '../ApiNotice.vue'
const emit = defineEmits<{ navigate: [] }>(),
  store = useImageStore(),
  router = useRouter(),
  { t } = useI18n()
const scroller = ref<HTMLDivElement>(),
  search = ref(store.query),
  editing = ref<ImageConversation>(),
  deleting = ref<ImageConversation>(),
  title = ref('')
const virtual = useVirtualizer(
  computed(() => ({
    count: store.conversations.length,
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => 44,
    overscan: 6,
  })),
)
const rows = computed(() => virtual.value.getVirtualItems())
onMounted(() => {
  if (!store.conversations.length) void store.list()
})
function apply() {
  store.query = search.value
  void store.list()
}
async function remove() {
  const id = deleting.value?.id
  if (!id) return
  const active = store.active === id
  await store.removeConversation(id)
  deleting.value = undefined
  if (active && !store.active) await router.replace('/create')
}
function rename(row: ImageConversation) {
  editing.value = row
  title.value = row.title
}
async function saveTitle() {
  if (!editing.value) return
  await store.update(editing.value, title.value)
  if (!store.error) editing.value = undefined
}
</script>
<template>
  <section class="chat-sidebar" :aria-label="t('images.history')">
    <RouterLink class="button chat-new" to="/create" @click="emit('navigate')"
      ><Plus :size="16" />{{ t('images.new') }}</RouterLink
    >
    <form class="chat-sidebar-search" @submit.prevent="apply">
      <Search :size="14" /><input
        v-model="search"
        type="search"
        maxlength="100"
        :aria-label="t('images.search')"
        :placeholder="t('images.search')"
      />
    </form>
    <ApiNotice :error="store.listError" />
    <p v-if="!store.conversations.length" class="field-hint">{{ t('images.emptyHistory') }}</p>
    <div ref="scroller" class="chat-sidebar-scroll">
      <div :style="{ height: virtual.getTotalSize() + 'px', position: 'relative' }">
        <div
          v-for="item in rows"
          :key="String(item.key)"
          class="chat-sidebar-row"
          :style="{ transform: 'translateY(' + item.start + 'px)' }"
        >
          <template v-if="store.conversations[item.index]"
            ><RouterLink
              :to="'/create/' + store.conversations[item.index]!.id"
              @click="emit('navigate')"
              ><Pin v-if="store.conversations[item.index]!.pinned" :size="12" /><span>{{
                store.conversations[item.index]!.title || t('images.untitled')
              }}</span></RouterLink
            >
            <DropdownMenuRoot
              ><DropdownMenuTrigger class="icon-button" :aria-label="t('images.details')"
                ><MoreHorizontal :size="16" /></DropdownMenuTrigger
              ><DropdownMenuPortal
                ><DropdownMenuContent class="dropdown-content" side="right" :collision-padding="12">
                  <DropdownMenuItem
                    class="menu-item"
                    @select="rename(store.conversations[item.index]!)"
                    >{{ t('images.rename') }}</DropdownMenuItem
                  >
                  <DropdownMenuItem
                    class="menu-item"
                    @select="
                      store.update(
                        store.conversations[item.index]!,
                        store.conversations[item.index]!.title,
                        !store.conversations[item.index]!.pinned,
                      )
                    "
                    >{{
                      t(store.conversations[item.index]!.pinned ? 'images.unpin' : 'images.pin')
                    }}</DropdownMenuItem
                  >
                  <DropdownMenuItem
                    class="menu-item danger"
                    @select="deleting = store.conversations[item.index]"
                    >{{ t('common.delete') }}</DropdownMenuItem
                  >
                </DropdownMenuContent></DropdownMenuPortal
              ></DropdownMenuRoot
            >
          </template>
        </div>
      </div>
      <button v-if="store.cursor" class="text-button" @click="store.list(true)">
        {{ t('images.more') }}
      </button>
    </div>
  </section>
  <ModalDialog
    :open="!!editing"
    :title="t('images.rename')"
    :description="t('images.history')"
    @update:open="editing = undefined"
    ><form class="stack" @submit.prevent="saveTitle">
      <label class="field"
        >{{ t('images.rename') }}<input v-model="title" maxlength="100" required /></label
      ><button class="button primary">{{ t('common.save') }}</button>
    </form></ModalDialog
  >
  <ModalDialog
    :open="!!deleting"
    :title="t('images.deleteConversation')"
    :description="t('images.deleteConversationHint')"
    @update:open="deleting = undefined"
    ><div class="dialog-actions">
      <button class="button" @click="deleting = undefined">{{ t('common.cancel') }}</button
      ><button class="button danger" @click="remove">{{ t('common.delete') }}</button>
    </div></ModalDialog
  >
</template>
