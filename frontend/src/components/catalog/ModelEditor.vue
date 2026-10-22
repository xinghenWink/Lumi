<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from 'lucide-vue-next'
import { catalog } from '../../api/catalog'
import {
  defaultCapabilities,
  type PlatformModel,
  type ModelInput,
  type Upstream,
  type RouteInput,
} from '../../api/catalog-contracts'
import ModalDialog from '../ModalDialog.vue'
import ApiNotice from '../ApiNotice.vue'
const props = defineProps<{ model: PlatformModel | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const busy = ref(false),
  validation = ref(''),
  error = shallowRef<unknown>(null),
  channelError = shallowRef<unknown>(null)
const channels = shallowRef<Upstream[]>([]),
  cursor = ref(''),
  channelLoading = ref(false)
const controller = new AbortController()
let alive = true
const routeInput = (route: RouteInput): RouteInput => ({
  upstream_id: route.upstream_id,
  upstream_model_name: route.upstream_model_name,
  priority: route.priority,
  weight: route.weight,
  enabled: route.enabled,
})
const model = props.model
const form = reactive<ModelInput>({
  version: model?.version ?? 0,
  display_name: model?.display_name ?? '',
  type: model?.type ?? 'chat',
  description: model?.description ?? '',
  icon: model?.icon ?? '',
  sort_order: model?.sort_order ?? 0,
  enabled: model?.enabled ?? false,
  is_default: model?.is_default ?? false,
  capabilities: model
    ? globalThis.structuredClone(model.capabilities)
    : defaultCapabilities('chat'),
  routes: model?.routes.map(routeInput) ?? [],
})
const sizes = ref(form.capabilities.sizes.join('\n'))
const choices = computed(() => {
  const names = new Map(
    props.model?.routes.map((route) => [route.upstream_id, route.upstream_name]) ?? [],
  )
  for (const channel of channels.value) names.set(channel.id, channel.name)
  return [...names].map(([id, name]) => ({ id, name }))
})
onMounted(() => void loadChannels())
onUnmounted(() => {
  alive = false
  controller.abort()
})
watch(
  () => form.type,
  (kind) => {
    form.capabilities = defaultCapabilities(kind)
    sizes.value = form.capabilities.sizes.join('\n')
  },
)
watch(
  () => form.enabled,
  (enabled) => {
    if (!enabled) form.is_default = false
  },
)
async function loadChannels(more = false) {
  channelLoading.value = true
  channelError.value = null
  try {
    const result = await catalog.channels(
      new URLSearchParams({ limit: '100', cursor: more ? cursor.value : '' }),
      controller.signal,
    )
    if (alive) {
      channels.value = more ? [...channels.value, ...result.items] : result.items
      cursor.value = result.next_cursor
    }
  } catch (failure) {
    if (alive) channelError.value = failure
  } finally {
    if (alive) channelLoading.value = false
  }
}
function addRoute() {
  form.routes.push({
    upstream_id: choices.value[0]?.id ?? '',
    upstream_model_name: '',
    priority: 0,
    weight: 1,
    enabled: true,
  })
}
async function save() {
  validation.value = ''
  error.value = null
  if (
    !form.display_name.trim() ||
    form.routes.some((route) => !route.upstream_id || !route.upstream_model_name.trim())
  ) {
    validation.value = t('catalog.invalid')
    return
  }
  const body: ModelInput = {
    ...form,
    display_name: form.display_name.trim(),
    capabilities: {
      ...form.capabilities,
      sizes:
        form.type === 'image'
          ? sizes.value
              .split(/[\n,]+/)
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
    },
    routes: form.routes.map((route) => ({
      ...route,
      upstream_model_name: route.upstream_model_name.trim(),
    })),
  }
  busy.value = true
  try {
    await catalog.saveModel(body, props.model?.id)
    if (alive) emit('saved')
  } catch (failure) {
    if (alive) error.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
</script>
<template>
  <ModalDialog
    :open="true"
    :busy="busy"
    :title="t(model ? 'catalog.editModel' : 'catalog.newModel')"
    :description="t('catalog.modelFormHint')"
    @update:open="
      (value) => {
        if (!value) emit('close')
      }
    "
  >
    <form class="stack catalog-model-form" @submit.prevent="save">
      <div class="form-grid">
        <label class="field"
          >{{ t('catalog.modelName')
          }}<input v-model="form.display_name" maxlength="80" required :disabled="busy" /></label
        ><label class="field"
          >{{ t('catalog.type')
          }}<select v-model="form.type" :aria-label="t('catalog.type')" :disabled="busy || !!model">
            <option value="chat">{{ t('catalog.chat') }}</option>
            <option value="image">{{ t('catalog.image') }}</option>
          </select></label
        >
      </div>
      <label class="field"
        >{{ t('catalog.description')
        }}<textarea v-model="form.description" maxlength="500" rows="2" :disabled="busy" />
      </label>
      <div class="form-grid">
        <label class="field"
          >{{ t('catalog.icon')
          }}<input v-model="form.icon" maxlength="40" :disabled="busy" /></label
        ><label class="field"
          >{{ t('catalog.sortOrder')
          }}<input
            v-model.number="form.sort_order"
            type="number"
            min="0"
            max="10000"
            step="1"
            required
            :disabled="busy"
        /></label>
      </div>
      <div class="catalog-flags">
        <label class="checkbox-label"
          ><input v-model="form.enabled" type="checkbox" :disabled="busy" />{{
            t('catalog.enabled')
          }}</label
        ><label class="checkbox-label"
          ><input v-model="form.is_default" type="checkbox" :disabled="busy || !form.enabled" />{{
            t('catalog.default')
          }}</label
        >
      </div>
      <section class="catalog-form-section">
        <h3>{{ t('catalog.capabilities') }}</h3>
        <template v-if="form.type === 'chat'"
          ><div class="catalog-flags">
            <label class="checkbox-label"
              ><input v-model="form.capabilities.stream" type="checkbox" :disabled="busy" />{{
                t('catalog.stream')
              }}</label
            ><label class="checkbox-label"
              ><input v-model="form.capabilities.vision" type="checkbox" :disabled="busy" />{{
                t('catalog.vision')
              }}</label
            >
          </div>
          <label class="field"
            >{{ t('catalog.maxContext')
            }}<input
              v-model.number="form.capabilities.max_context_tokens"
              type="number"
              min="1"
              max="1000000"
              step="1"
              required
              :disabled="busy" /></label
        ></template>
        <template v-else>
          <fieldset class="catalog-quality">
            <legend>{{ t('catalog.qualities') }}</legend>
            <label
              v-for="quality in ['low', 'medium', 'high'] as const"
              :key="quality"
              class="checkbox-label"
              ><input
                v-model="form.capabilities.qualities"
                type="checkbox"
                :value="quality"
                :disabled="busy"
              />{{ t('credits.' + quality) }}</label
            >
          </fieldset>
          <label class="field"
            >{{ t('catalog.sizes')
            }}<textarea
              v-model="sizes"
              :aria-label="t('catalog.sizes')"
              rows="3"
              required
              :disabled="busy"
            /><span class="field-hint">{{ t('catalog.sizesHint') }}</span></label
          >
          <div class="form-grid">
            <label class="field"
              >{{ t('catalog.maxN')
              }}<input
                v-model.number="form.capabilities.max_n"
                type="number"
                min="1"
                max="10"
                step="1"
                required
                :disabled="busy" /></label
            ><label class="field"
              >{{ t('catalog.responseFormat')
              }}<select
                v-model="form.capabilities.response_format"
                :aria-label="t('catalog.responseFormat')"
                :disabled="busy"
              >
                <option value="b64_json">{{ t('catalog.base64') }}</option>
                <option value="url">{{ t('catalog.url') }}</option>
              </select></label
            >
          </div>
          <label class="checkbox-label"
            ><input v-model="form.capabilities.supports_edit" type="checkbox" :disabled="busy" />{{
              t('catalog.supportsEdit')
            }}</label
          ><label class="field"
            >{{ t('catalog.maxReferences')
            }}<input
              v-model.number="form.capabilities.max_reference_images"
              type="number"
              :min="form.capabilities.supports_edit ? 1 : 0"
              max="4"
              step="1"
              required
              :disabled="busy"
          /></label>
        </template>
      </section>
      <section class="catalog-form-section">
        <div class="section-heading">
          <h3>{{ t('catalog.routes') }}</h3>
          <button
            class="button compact"
            type="button"
            :disabled="busy || form.routes.length >= 20"
            @click="addRoute"
          >
            <Plus :size="14" />{{ t('catalog.addRoute') }}
          </button>
        </div>
        <p class="field-hint">{{ t('catalog.routesHint') }}</p>
        <ApiNotice :error="channelError" /><button
          v-if="channelError"
          class="button compact"
          type="button"
          @click="loadChannels()"
        >
          {{ t('common.retry') }}
        </button>
        <p v-if="!form.routes.length" class="field-hint">{{ t('catalog.noRoutes') }}</p>
        <div v-for="(route, index) in form.routes" :key="index" class="catalog-route-card">
          <div class="form-grid">
            <label class="field"
              >{{ t('catalog.channel')
              }}<select
                v-model="route.upstream_id"
                :aria-label="t('catalog.channel') + ' ' + (index + 1)"
                required
                :disabled="busy"
              >
                <option value="">{{ t('catalog.chooseChannel') }}</option>
                <option v-for="channel in choices" :key="channel.id" :value="channel.id">
                  {{ channel.name }}
                </option>
              </select></label
            ><label class="field"
              >{{ t('catalog.remoteModel')
              }}<input
                v-model="route.upstream_model_name"
                :aria-label="t('catalog.remoteModel') + ' ' + (index + 1)"
                maxlength="200"
                required
                :disabled="busy"
            /></label>
          </div>
          <div class="catalog-route-options">
            <label class="field"
              >{{ t('catalog.priority')
              }}<input
                v-model.number="route.priority"
                type="number"
                min="0"
                max="10000"
                step="1"
                required
                :disabled="busy" /></label
            ><label class="field"
              >{{ t('catalog.weight')
              }}<input
                v-model.number="route.weight"
                type="number"
                min="1"
                max="10000"
                step="1"
                required
                :disabled="busy" /></label
            ><label class="checkbox-label"
              ><input
                v-model="route.enabled"
                type="checkbox"
                :aria-label="t('catalog.enabled') + ' ' + t('catalog.routes') + ' ' + (index + 1)"
                :disabled="busy"
              />{{ t('catalog.enabled') }}</label
            ><button
              class="icon-button danger-text"
              type="button"
              :aria-label="t('catalog.removeRoute') + ' ' + (index + 1)"
              :disabled="busy"
              @click="form.routes.splice(index, 1)"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
        <button
          v-if="cursor"
          class="button compact"
          type="button"
          :disabled="channelLoading"
          @click="loadChannels(true)"
        >
          {{ t('catalog.moreChannels') }}
        </button>
      </section>
      <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
      <ApiNotice :error="error" />
      <div class="dialog-actions">
        <button class="button" type="button" :disabled="busy" @click="emit('close')">
          {{ t('common.cancel') }}</button
        ><button class="button primary" :disabled="busy">
          {{ t(busy ? 'common.saving' : 'catalog.saveModel') }}
        </button>
      </div>
    </form>
  </ModalDialog>
</template>
