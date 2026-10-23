<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, Download, Copy, Plus } from 'lucide-vue-next'
import type { ImageFile } from '../../api/images'
import { useImageActions } from '../../features/images/actions'
import ModalDialog from '../ModalDialog.vue'
import ApiNotice from '../ApiNotice.vue'
import ProtectedImage from './ProtectedImage.vue'
const props = defineProps<{
  open: boolean
  files: ImageFile[]
  index: number
  prompt: string
  parameters: string
  allowEdit?: boolean
}>()
const emit = defineEmits<{ 'update:open': [boolean]; edit: [ImageFile]; navigate: [number] }>()
const { t } = useI18n(),
  currentIndex = ref(0),
  zoom = ref(100),
  joining = ref(false),
  actions = useImageActions()
watch(
  () => [props.index, props.open],
  () => {
    currentIndex.value = props.index
    if (props.open) joining.value = false
    zoom.value = 100
    actions.copied.value = false
  },
)
const file = computed(() => props.files[currentIndex.value])
function move(direction: number) {
  currentIndex.value = (currentIndex.value + direction + props.files.length) % props.files.length
  zoom.value = 100
  emit('navigate', currentIndex.value)
}
function edit(file: ImageFile) {
  joining.value = true
  emit('edit', file)
  emit('update:open', false)
}
</script>
<template>
  <ModalDialog
    :open="open"
    :title="t('images.preview')"
    :description="parameters"
    wide
    @update:open="emit('update:open', $event)"
    @close-auto-focus="
      (event) => {
        if (joining) event.preventDefault()
      }
    "
  >
    <template v-if="file">
      <div class="image-preview-stage">
        <div class="image-preview-scroll">
          <ProtectedImage
            :file="file"
            original
            :alt="prompt || t('images.preview')"
            :style="{ width: zoom + '%', maxWidth: 'none' }"
          />
        </div>
        <button
          v-if="files.length > 1"
          class="icon-button preview-previous"
          :aria-label="t('images.previous')"
          @click="move(-1)"
        >
          <ChevronLeft />
        </button>
        <button
          v-if="files.length > 1"
          class="icon-button preview-next"
          :aria-label="t('images.next')"
          @click="move(1)"
        >
          <ChevronRight />
        </button>
      </div>
      <p class="image-preview-prompt">{{ prompt }}</p>
      <div class="image-preview-actions">
        <label
          >{{ t('images.zoom') }}
          <select v-model="zoom" :aria-label="t('images.zoom')">
            <option v-for="n in [50, 100, 150, 200]" :key="n" :value="n">{{ n }}%</option>
          </select></label
        >
        <span class="field-hint">{{ t('images.originalSize', file) }}</span>
        <button class="button compact" @click="actions.download(file)">
          <Download :size="15" />{{ t('images.download') }}
        </button>
        <button class="button compact" @click="actions.copy(file)">
          <Copy :size="15" />{{ t(actions.copied.value ? 'images.copied' : 'images.copy') }}
        </button>
        <button v-if="allowEdit !== false" class="button compact" @click="edit(file)">
          <Plus :size="15" />{{ t('images.edit') }}
        </button>
      </div>
      <ApiNotice :error="actions.error.value" />
    </template>
  </ModalDialog>
</template>
