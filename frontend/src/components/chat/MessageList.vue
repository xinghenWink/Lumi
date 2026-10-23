<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { ArrowDown } from 'lucide-vue-next'
import type { Message } from '../../api/chat'
import MessageCard from './MessageCard.vue'
import { lastMessage } from '../../features/chat/messages'
const props = defineProps<{
  items: Message[]
  busy: boolean
  hasOlder: boolean
  loading: boolean
}>()
const emit = defineEmits<{ edit: [message: Message]; regenerate: []; older: [] }>()
const { t } = useI18n(),
  scroller = ref<HTMLDivElement>(),
  body = ref<HTMLDivElement>(),
  end = ref<HTMLDivElement>()
const following = ref(true),
  lastUser = computed(() => lastMessage(props.items, 'user')?.id),
  lastAssistant = computed(() => lastMessage(props.items, 'assistant')?.id)
const enabled = computed(() => props.items.length > 100)
const virtual = useVirtualizer(
  computed(() => ({
    count: props.items.length,
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => 180,
    overscan: 6,
    enabled: enabled.value,
    getItemKey: (i: number) => props.items[i]?.id ?? i,
  })),
)
const rows = computed(() => virtual.value.getVirtualItems())
let observer: IntersectionObserver | undefined,
  resize: ResizeObserver | undefined,
  frame: number | undefined
function latest() {
  end.value?.scrollIntoView({ block: 'end', behavior: 'instant' })
  following.value = true
}
function follow() {
  if (frame !== undefined) return
  frame = requestAnimationFrame(() => {
    frame = undefined
    if (following.value) latest()
  })
}
watch(
  () => props.items,
  () => {
    if (following.value) void nextTick(follow)
  },
)
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      following.value = entries.some((e) => e.isIntersecting)
    },
    { root: scroller.value ?? null, threshold: 0.1 },
  )
  if (end.value) observer.observe(end.value)
  resize = new ResizeObserver(() => {
    if (following.value) follow()
  })
  if (body.value) resize.observe(body.value)
  latest()
})
onUnmounted(() => {
  observer?.disconnect()
  resize?.disconnect()
  if (frame !== undefined) cancelAnimationFrame(frame)
})
function measure(element: unknown) {
  if (element instanceof Element) virtual.value.measureElement(element)
}
</script>
<template>
  <div class="chat-message-region">
    <div ref="scroller" class="chat-message-scroll" :aria-label="t('chat.messages')" tabindex="0">
      <div ref="body" class="chat-message-body">
        <button
          v-if="hasOlder"
          class="button chat-older"
          :disabled="loading"
          @click="emit('older')"
        >
          {{ t('chat.older') }}
        </button>
        <div
          v-if="enabled"
          class="chat-virtual-messages"
          :style="{ height: virtual.getTotalSize() + 'px' }"
        >
          <div
            v-for="row in rows"
            :key="String(row.key)"
            :ref="measure"
            :data-index="row.index"
            class="chat-virtual-row"
            :style="{ transform: 'translateY(' + row.start + 'px)' }"
          >
            <MessageCard
              v-if="items[row.index]"
              :message="items[row.index]!"
              :last-user="items[row.index]?.id === lastUser"
              :last-assistant="items[row.index]?.id === lastAssistant"
              :busy="busy"
              @edit="emit('edit', $event)"
              @regenerate="emit('regenerate')"
            />
          </div>
        </div>
        <template v-else
          ><MessageCard
            v-for="message in items"
            :key="message.id"
            :message="message"
            :last-user="message.id === lastUser"
            :last-assistant="message.id === lastAssistant"
            :busy="busy"
            @edit="emit('edit', $event)"
            @regenerate="emit('regenerate')"
        /></template>
        <div ref="end" class="chat-scroll-end" aria-hidden="true" />
      </div>
    </div>
    <button v-if="!following" class="button chat-latest" @click="latest">
      <ArrowDown :size="15" />{{ t('chat.latest') }}
    </button>
  </div>
</template>
