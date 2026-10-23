<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useI18n } from 'vue-i18n'
import type { ImageTask, ImageFile } from '../../api/images'
import ImageTaskCard from './ImageTaskCard.vue'
const props = defineProps<{ tasks: ImageTask[]; older: boolean; loading: boolean }>()
const emit = defineEmits<{
  older: []
  cancel: [ImageTask]
  reuse: [ImageTask]
  edit: [ImageFile]
  changed: []
}>()
const { t } = useI18n(),
  scroller = ref<HTMLDivElement>(),
  end = ref<HTMLDivElement>(),
  following = ref(true)
const enabled = computed(() => props.tasks.length > 50)
const virtual = useVirtualizer(
  computed(() => ({
    count: props.tasks.length,
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => 550,
    overscan: 3,
    enabled: enabled.value,
    getItemKey: (i: number) => props.tasks[i]?.id ?? i,
  })),
)
const rows = computed(() => virtual.value.getVirtualItems())
function measure(el: unknown) {
  if (el instanceof Element) virtual.value.measureElement(el)
}
let observer: IntersectionObserver | undefined
function scroll() {
  end.value?.scrollIntoView({ block: 'end', behavior: 'instant' })
}
watch(
  () => props.tasks.at(-1)?.id,
  () => {
    if (following.value) void nextTick(scroll)
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
  scroll()
})
onUnmounted(() => observer?.disconnect())
</script>
<template>
  <div ref="scroller" class="image-task-scroll" :aria-label="t('images.history')" tabindex="0">
    <div class="image-task-body">
      <button v-if="older" class="button image-older" :disabled="loading" @click="emit('older')">
        {{ t('images.older') }}
      </button>
      <div
        v-if="enabled"
        class="image-task-virtual"
        :style="{ height: virtual.getTotalSize() + 'px' }"
      >
        <div
          v-for="row in rows"
          :key="String(row.key)"
          :ref="measure"
          class="image-task-virtual-row"
          :data-index="row.index"
          :style="{ transform: 'translateY(' + row.start + 'px)' }"
        >
          <ImageTaskCard
            v-if="tasks[row.index]"
            :task="tasks[row.index]!"
            @cancel="emit('cancel', $event)"
            @reuse="emit('reuse', $event)"
            @edit="emit('edit', $event)"
            @changed="emit('changed')"
          />
        </div>
      </div>
      <template v-else
        ><ImageTaskCard
          v-for="task in tasks"
          :key="task.id"
          :task="task"
          @cancel="emit('cancel', $event)"
          @reuse="emit('reuse', $event)"
          @edit="emit('edit', $event)"
          @changed="emit('changed')"
      /></template>
      <div ref="end" class="chat-scroll-end" />
    </div>
  </div>
</template>
