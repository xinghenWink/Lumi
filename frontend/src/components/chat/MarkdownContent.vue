<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { partitionMarkdown, renderMarkdown } from '../../features/chat/markdown'
const props = defineProps<{ content: string; complete: boolean }>()
const { t, locale } = useI18n()
const blocks = shallowRef<{ key: number; html: string }[]>([])
const cache = new Map<number, { source: string; complete: boolean; html: string }>()
let generation = 0
let cachedLocale = ''
watch(
  () => [props.content, props.complete, locale.value] as const,
  async () => {
    if (cachedLocale !== locale.value) {
      cache.clear()
      cachedLocale = locale.value
    }
    const current = ++generation
    const parts = partitionMarkdown(props.content, props.complete)
    const next: { key: number; html: string }[] = []
    for (const part of parts) {
      const previous = cache.get(part.key)
      let html: string
      if (previous?.source === part.source && previous.complete === part.complete)
        html = previous.html
      else {
        html = await renderMarkdown(part.source, part.complete, t('chat.copyCode'))
        if (current !== generation) return
        cache.set(part.key, { source: part.source, complete: part.complete, html })
      }
      next.push({ key: part.key, html })
    }
    if (current === generation) blocks.value = next
  },
  { immediate: true },
)
async function copyCode(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('button[data-copy-code]')
  const code = button?.closest('.chat-code')?.querySelector('code')
  if (!button || !code) return
  try {
    await navigator.clipboard.writeText(code.textContent ?? '')
    button.textContent = t('chat.copied')
  } catch {
    button.textContent = t('chat.copyCode')
  }
}
</script>
<template>
  <div class="chat-markdown" @click="copyCode">
    <!-- HTML reaches this sink only through the DOMPurify allowlist in renderMarkdown. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-for="block in blocks" :key="block.key" v-html="block.html" />
  </div>
</template>
