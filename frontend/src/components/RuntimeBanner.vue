<script setup lang="ts">
import { ref, shallowRef, watch, onUnmounted } from 'vue'
import { operations, type Announcement } from '../api/operations'
import { useSiteStore } from '../stores/site'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import MarkdownContent from './chat/MarkdownContent.vue'
const site = useSiteStore(),
  auth = useAuthStore(),
  theme = useThemeStore(),
  items = shallowRef<Announcement[]>([]),
  loaded = ref(false)
let generation = 0
async function load() {
  const owner = auth.user?.id,
    current = ++generation
  if (!owner) return
  await site.load()
  try {
    const result = await operations.announcements()
    if (current === generation && auth.user?.id === owner) {
      items.value = result.items
      loaded.value = true
    }
  } catch {
    /* Existing announcements remain visible during temporary network failures. */
  }
}
watch(
  () => auth.user?.id,
  async (id) => {
    items.value = []
    if (!id) return
    void load()
    try {
      const pref = await operations.preferences()
      if (auth.user?.id === id) theme.set(pref.theme)
    } catch {
      /* Local appearance remains available while offline. */
    }
  },
  { immediate: true },
)
const interval = setInterval(() => void load(), 30000)
onUnmounted(() => {
  generation++
  clearInterval(interval)
})
</script>
<template>
  <aside v-if="loaded && items.length" class="ops-announcements">
    <MarkdownContent
      v-for="item in items"
      :key="item.id"
      :content="item.content"
      :complete="true"
    />
  </aside>
</template>
