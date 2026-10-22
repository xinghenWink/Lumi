<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui'
import { Check, ChevronDown, Boxes } from 'lucide-vue-next'
import { useModelStore } from '../../stores/models'
import type { ModelKind } from '../../api/catalog-contracts'
import ApiNotice from '../ApiNotice.vue'
const props = defineProps<{ kind: ModelKind }>()
const { t } = useI18n()
const models = useModelStore()
const selected = computed(() =>
  models.items[props.kind].find((item) => item.id === models.selected[props.kind]),
)
watch(
  () => props.kind,
  (kind) => void models.load(kind),
  { immediate: true },
)
onUnmounted(() => models.cancel(props.kind))
</script>
<template>
  <div class="catalog-model-picker">
    <ApiNotice :error="models.errors[kind]" />
    <button v-if="models.errors[kind]" class="button compact" @click="models.load(kind)">
      {{ t('common.retry') }}
    </button>
    <p
      v-else-if="!models.loading[kind] && !models.items[kind].length"
      class="field-hint"
      role="status"
    >
      {{ t('catalog.noAvailableHint') }}
    </p>
    <DropdownMenuRoot>
      <DropdownMenuTrigger
        class="button catalog-model-trigger"
        :aria-label="t('catalog.selectModel')"
        :disabled="models.loading[kind] || !models.items[kind].length"
      >
        <span v-if="selected?.icon" class="catalog-model-icon" aria-hidden="true">{{
          selected.icon
        }}</span>
        <Boxes v-else :size="16" /><span>{{
          models.loading[kind]
            ? t('catalog.loadingModels')
            : (selected?.display_name ?? t('catalog.noAvailable'))
        }}</span
        ><ChevronDown :size="14" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal
        ><DropdownMenuContent
          class="catalog-model-menu"
          side="top"
          align="end"
          :side-offset="8"
          :collision-padding="12"
          :aria-label="t('catalog.availableModels')"
        >
          <DropdownMenuItem
            v-for="model in models.items[kind]"
            :key="model.id"
            class="menu-item catalog-model-item"
            :class="{ active: model.id === models.selected[kind] }"
            @select="models.select(kind, model.id)"
          >
            <span v-if="model.icon" class="catalog-model-icon" aria-hidden="true">{{
              model.icon
            }}</span>
            <Boxes v-else :size="16" aria-hidden="true" />
            <span class="catalog-model-copy"
              ><strong>{{ model.display_name }}</strong
              ><span v-if="model.description">{{ model.description }}</span></span
            ><Check v-if="model.id === models.selected[kind]" :size="16" aria-hidden="true" />
          </DropdownMenuItem> </DropdownMenuContent
      ></DropdownMenuPortal>
    </DropdownMenuRoot>
  </div>
</template>
