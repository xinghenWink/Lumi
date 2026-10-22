<script setup lang="ts">
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{ open: boolean; title: string; description: string; busy?: boolean }>(),
  { busy: false },
)
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { t } = useI18n()
function change(value: boolean) {
  if (!props.busy) emit('update:open', value)
}
function guard(event: Event) {
  if (props.busy) event.preventDefault()
}
</script>

<template>
  <DialogRoot :open="open" @update:open="change">
    <DialogPortal
      ><DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content" @escape-key-down="guard" @interact-outside="guard">
        <div class="dialog-heading">
          <DialogTitle>{{ title }}</DialogTitle
          ><DialogClose class="icon-button" :disabled="busy" :aria-label="t('common.close')"
            ><X :size="19"
          /></DialogClose>
        </div>
        <DialogDescription class="dialog-description">{{ description }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
