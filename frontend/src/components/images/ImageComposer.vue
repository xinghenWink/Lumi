<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp, ImagePlus, Images, X } from 'lucide-vue-next'
import { images, type ImageFile, type ImageInput } from '../../api/images'
import { ApiError } from '../../api/transport'
import { useImageStore } from '../../stores/images'
import { useModelStore } from '../../stores/models'
import { useAuthStore } from '../../stores/auth'
import ModelPicker from '../catalog/ModelPicker.vue'
import ApiNotice from '../ApiNotice.vue'
import ProtectedImage from './ProtectedImage.vue'
import ImageLibrary from './ImageLibrary.vue'
const store = useImageStore(),
  models = useModelStore(),
  auth = useAuthStore(),
  router = useRouter(),
  { t } = useI18n()
const picker = ref<HTMLInputElement>(),
  textarea = ref<HTMLTextAreaElement>(),
  library = ref(false),
  uploading = ref(false)
const localError = shallowRef<unknown>(),
  pricingError = shallowRef<unknown>(),
  quotes = shallowRef<Partial<Record<ImageInput['quality'], number>>>({})
const pricing = ref(false),
  model = computed(() => models.items.image.find((m) => m.id === models.selected.image))
const sizes = computed(
  () => store.configuration?.sizes.filter((s) => model.value?.capabilities.sizes.includes(s)) ?? [],
)
const ratios = computed(() =>
  Object.entries(store.configuration?.ratio_sizes ?? {}).filter(([, size]) =>
    sizes.value.includes(size),
  ),
)
const maxN = computed(() =>
  Math.min(store.configuration?.max_n ?? 1, model.value?.capabilities.max_n ?? 1),
)
const maxReferences = computed(() =>
  model.value?.capabilities.supports_edit
    ? Math.min(
        store.configuration?.max_references ?? 0,
        model.value.capabilities.max_reference_images,
      )
    : 0,
)
const qualities = computed(() =>
  (model.value?.capabilities.qualities ?? []).filter((q) => quotes.value[q] !== undefined),
)
const cost = computed(() =>
  quotes.value[store.draft.quality] === undefined
    ? undefined
    : (quotes.value[store.draft.quality] ?? 0) * store.draft.n,
)
const invalidReferences = computed(() => store.draft.references.length > maxReferences.value)
const disabled = computed(
  () =>
    store.sending ||
    uploading.value ||
    pricing.value ||
    !store.draft.prompt.trim() ||
    !model.value ||
    cost.value === undefined ||
    cost.value > store.balance ||
    invalidReferences.value,
)
let quoteController: AbortController | undefined, uploadController: AbortController | undefined
watch(
  [
    () => sizes.value.join(','),
    () => store.active,
    maxN,
    () => store.draft.n,
    () => store.draft.size,
  ],
  () => {
    if (!sizes.value.includes(store.draft.size))
      store.draft.size = sizes.value.includes('1024x1024') ? '1024x1024' : (sizes.value[0] ?? '')
    store.draft.n = Math.max(1, Math.min(store.draft.n, maxN.value))
  },
  { immediate: true },
)
watch(
  () => store.draft.size,
  (size) => {
    if (!ratios.value.some(([ratio, s]) => s === size && ratio === store.draft.ratio))
      store.draft.ratio = ''
  },
)
watch(
  [
    () => models.selected.image,
    () => store.draft.size,
    () => store.draft.references.length > 0,
    () => auth.user?.id,
    () => store.active,
  ],
  async () => {
    quoteController?.abort()
    quotes.value = {}
    pricingError.value = null
    const selected = model.value,
      size = store.draft.size
    if (!selected || !size || !auth.user) return
    const current = new AbortController()
    quoteController = current
    pricing.value = true
    try {
      const result = await Promise.all(
        selected.capabilities.qualities.map(async (quality) => {
          try {
            const q = await images.quote(
              {
                model_id: selected.id,
                operation: store.draft.references.length ? 'edit' : 'generate',
                quality,
                size,
                count: 1,
              },
              current.signal,
            )
            return [quality, q.unit_price] as const
          } catch (e) {
            if (e instanceof ApiError && e.code === 'PRICE_UNAVAILABLE') return null
            throw e
          }
        }),
      )
      if (current.signal.aborted) return
      quotes.value = Object.fromEntries(result.filter((r) => r !== null))
      if (!qualities.value.includes(store.draft.quality))
        store.draft.quality = qualities.value.includes('medium')
          ? 'medium'
          : (qualities.value[0] ?? 'medium')
    } catch (e) {
      if (!current.signal.aborted) pricingError.value = e
    } finally {
      if (!current.signal.aborted) pricing.value = false
    }
  },
  { immediate: true },
)
function add(file: ImageFile) {
  if (store.draft.references.some((f) => f.id === file.id)) return
  if (!maxReferences.value) {
    localError.value = new ApiError('IMAGE_REFERENCE_INVALID')
    return
  }
  if (store.draft.references.length >= maxReferences.value) {
    localError.value = new ApiError('IMAGE_REFERENCE_INVALID')
    return
  }
  if (file.size > (store.configuration?.max_upload_bytes ?? 10_485_760)) {
    localError.value = new ApiError('FILE_TOO_LARGE')
    return
  }
  store.draft.references = [...store.draft.references, file]
  textarea.value?.focus()
}
async function upload(files: File[]) {
  localError.value = null
  const owner = auth.user?.id,
    conversation = store.active
  uploadController?.abort()
  const current = new AbortController()
  uploadController = current
  uploading.value = true
  try {
    for (const file of files) {
      if (!maxReferences.value || store.draft.references.length >= maxReferences.value)
        throw new ApiError('IMAGE_REFERENCE_INVALID')
      if (file.size > (store.configuration?.max_upload_bytes ?? 10_485_760))
        throw new ApiError('FILE_TOO_LARGE')
      const result = await images.upload(file, current.signal)
      if (current.signal.aborted || owner !== auth.user?.id || conversation !== store.active) return
      add(result)
    }
  } catch (e) {
    if (!current.signal.aborted && owner === auth.user?.id) localError.value = e
  } finally {
    if (!current.signal.aborted) uploading.value = false
  }
}
function choose(event: Event) {
  const input = event.target
  if (input instanceof HTMLInputElement) {
    void upload(Array.from(input.files ?? []))
    input.value = ''
  }
}
function paste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (files.length) {
    event.preventDefault()
    void upload(files)
  }
}
function drop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) {
    event.preventDefault()
    void upload(files)
  }
}
async function submit() {
  if (disabled.value && !store.pending) return
  const id = await store.submit()
  if (id) await router.replace('/create/' + id)
}
function ratioChanged() {
  const size = store.configuration?.ratio_sizes[store.draft.ratio]
  if (size) store.draft.size = size
}
watch(
  () => store.active,
  () => {
    uploadController?.abort()
    uploading.value = false
    localError.value = null
  },
)
onUnmounted(() => {
  quoteController?.abort()
  uploadController?.abort()
})
onMounted(() => {
  if (store.draft.references.length) textarea.value?.focus()
})
watch(
  () => store.draft.references.length,
  (count, previous) => {
    if (count > previous) void nextTick(() => textarea.value?.focus())
  },
)
</script>
<template>
  <div class="image-composer-wrap">
    <ApiNotice :error="store.error || localError || pricingError" />
    <button v-if="store.pending" class="button compact" :disabled="store.sending" @click="submit">
      {{ t('images.retry') }}
    </button>
    <form
      class="image-composer panel"
      @submit.prevent="submit"
      @dragover.prevent
      @drop="drop"
      @paste="paste"
    >
      <div v-if="store.draft.references.length" class="image-references">
        <div v-for="file in store.draft.references" :key="file.id" class="image-reference">
          <ProtectedImage :file="file" :alt="t('images.references')" /><button
            type="button"
            class="icon-button"
            :aria-label="t('images.removeReference')"
            @click="store.draft.references = store.draft.references.filter((f) => f.id !== file.id)"
          >
            <X :size="12" />
          </button>
        </div>
      </div>
      <label class="sr-only" for="image-prompt">{{ t('images.prompt') }}</label>
      <textarea
        id="image-prompt"
        ref="textarea"
        v-model="store.draft.prompt"
        :placeholder="t('images.placeholder')"
        rows="2"
        maxlength="64000"
        :disabled="store.sending || !!store.pending"
      />
      <div class="image-parameters">
        <label
          >{{ t('images.quality')
          }}<select
            v-model="store.draft.quality"
            :aria-label="t('images.quality')"
            :disabled="pricing || !!store.pending"
          >
            <option v-for="quality in qualities" :key="quality" :value="quality">
              {{ t('images.' + quality) }}
            </option>
          </select></label
        >
        <label
          >{{ t('images.size')
          }}<select
            v-model="store.draft.size"
            :aria-label="t('images.size')"
            :disabled="!!store.pending"
          >
            <option v-for="size in sizes" :key="size" :value="size">
              {{ size === 'auto' ? t('images.auto') : size }}
            </option>
          </select></label
        >
        <label
          >{{ t('images.ratio')
          }}<select
            v-model="store.draft.ratio"
            :aria-label="t('images.ratio')"
            :disabled="!!store.pending"
            @change="ratioChanged"
          >
            <option value="">{{ t('images.custom') }}</option>
            <option v-for="[ratio] in ratios" :key="ratio" :value="ratio">{{ ratio }}</option>
          </select></label
        >
        <label
          >{{ t('images.count')
          }}<select
            v-model="store.draft.n"
            :aria-label="t('images.count')"
            :disabled="!!store.pending"
          >
            <option v-for="n in maxN" :key="n" :value="n">{{ n }}</option>
          </select></label
        >
      </div>
      <p v-if="invalidReferences" class="error-text">
        {{
          maxReferences
            ? t('images.referenceLimit', { count: maxReferences })
            : t('images.editUnsupported')
        }}
      </p>
      <div class="image-composer-bottom">
        <div class="image-upload-actions">
          <input
            ref="picker"
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            tabindex="-1"
            @change="choose"
          />
          <button
            type="button"
            class="icon-button"
            :disabled="uploading || !maxReferences || !!store.pending"
            :aria-label="t('images.upload')"
            @click="picker?.click()"
          >
            <ImagePlus :size="19" />
          </button>
          <button
            type="button"
            class="icon-button"
            :disabled="!maxReferences || !!store.pending"
            :aria-label="t('images.library')"
            @click="library = true"
          >
            <Images :size="19" />
          </button>
        </div>
        <div class="image-send-actions">
          <ModelPicker kind="image" /><button
            class="button primary image-send"
            :disabled="disabled || !!store.pending"
            :aria-label="t('images.send')"
          >
            <ArrowUp :size="18" /><span>{{ t('images.send') }}</span>
          </button>
        </div>
      </div>
    </form>
    <div class="image-composer-caption">
      <span
        >{{ cost === undefined ? t('images.noPrice') : t('images.estimate', { cost }) }} ·
        {{ t('images.balance', { balance: store.balance }) }}</span
      ><RouterLink v-if="cost !== undefined && cost > store.balance" to="/me/credits">{{
        t('images.insufficient')
      }}</RouterLink>
    </div>
    <p class="image-composer-hint">{{ t('images.leaveHint') }}</p>
    <ImageLibrary :open="library" @update:open="library = $event" @choose="add" />
  </div>
</template>
