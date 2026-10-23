<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Download, Plus, Trash2, Image } from 'lucide-vue-next'
import { images, type GalleryItem, type ImageFile } from '../api/images'
import { useImageStore } from '../stores/images'
import { useAuthStore } from '../stores/auth'
import { useImageActions } from '../features/images/actions'
import ImageFilters from '../components/images/ImageFilters.vue'
import ProtectedImage from '../components/images/ProtectedImage.vue'
import ImagePreview from '../components/images/ImagePreview.vue'
import ModalDialog from '../components/ModalDialog.vue'
import ApiNotice from '../components/ApiNotice.vue'
import { operations } from '../api/operations'
const { t } = useI18n(),
  auth = useAuthStore(),
  store = useImageStore(),
  router = useRouter(),
  actions = useImageActions()
const items = shallowRef<GalleryItem[]>([]),
  cursor = ref(''),
  loading = ref(false),
  error = shallowRef<unknown>()
const query = shallowRef(new URLSearchParams({ limit: '40' })),
  scroller = ref<HTMLDivElement>(),
  columns = ref(3)
const selected = shallowRef<GalleryItem>(),
  previewIndex = ref(0),
  preview = ref(false),
  deleting = shallowRef<GalleryItem>(),
  deletingBusy = ref(false)
const batchIDs = ref<string[]>([]),
  batchDeleteOpen = ref(false),
  batchBusy = ref(false)
async function downloadBatch() {
  batchBusy.value = true
  error.value = undefined
  try {
    await operations.downloadImages(batchIDs.value)
  } catch (e) {
    error.value = e
  } finally {
    batchBusy.value = false
  }
}
async function deleteBatch() {
  batchBusy.value = true
  error.value = undefined
  try {
    await operations.deleteImages(batchIDs.value)
    batchIDs.value = []
    batchDeleteOpen.value = false
    await load()
  } catch (e) {
    error.value = e
  } finally {
    batchBusy.value = false
  }
}
let controller: AbortController | undefined, resize: ResizeObserver | undefined
const rows = computed(() => Math.ceil(items.value.length / columns.value))
const virtual = useVirtualizer(
  computed(() => ({
    count: rows.value,
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => 310,
    overscan: 2,
  })),
)
const visible = computed(() => virtual.value.getVirtualItems())
function measure(el: unknown) {
  if (el instanceof Element) virtual.value.measureElement(el)
}
async function load(more = false) {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = null
  if (!more) {
    batchIDs.value = []
    items.value = []
    cursor.value = ''
    scroller.value?.scrollTo(0, 0)
  }
  try {
    const q = new URLSearchParams(query.value)
    if (more) q.set('cursor', cursor.value)
    const result = await images.gallery(q, current.signal)
    if (current.signal.aborted) return
    items.value = more ? [...items.value, ...result.items] : result.items
    cursor.value = result.next_cursor
  } catch (e) {
    if (!current.signal.aborted) error.value = e
  } finally {
    if (!current.signal.aborted) loading.value = false
  }
}
function filter(q: URLSearchParams) {
  query.value = q
  void load()
}
function open(item: GalleryItem) {
  selected.value = item
  previewIndex.value = items.value.findIndex((i) => i.file.id === item.file.id)
  preview.value = true
}
async function edit(file: ImageFile) {
  await store.open('')
  store.draft.references = [file]
  await router.push('/create')
}
async function remove() {
  if (!deleting.value) return
  deletingBusy.value = true
  error.value = null
  const owner = auth.user?.id
  try {
    const id = deleting.value.file.id
    await images.removeFile(id)
    if (owner !== auth.user?.id) return
    items.value = items.value.filter((item) => item.file.id !== id)
    deleting.value = undefined
  } catch (e) {
    if (owner === auth.user?.id) error.value = e
  } finally {
    deletingBusy.value = false
  }
}
watch(previewIndex, (value) => {
  selected.value = items.value[value]
})
watch(
  () => auth.user?.id,
  () => {
    controller?.abort()
    items.value = []
    selected.value = undefined
    deleting.value = undefined
    preview.value = false
  },
)
onMounted(() => {
  void load()
  resize = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 900
    columns.value = width < 500 ? 1 : width < 850 ? 2 : width < 1200 ? 3 : 4
  })
  if (scroller.value) resize.observe(scroller.value)
})
onUnmounted(() => {
  controller?.abort()
  resize?.disconnect()
})
</script>
<template>
  <div class="page-container image-gallery-page">
    <div class="page-heading">
      <div>
        <h1>{{ t('images.gallery') }}</h1>
        <p>{{ t('images.galleryHint') }}</p>
      </div>
    </div>
    <ImageFilters @apply="filter" /><ApiNotice :error="error || actions.error.value" />
    <div class="ops-toolbar">
      <span>{{ t('ops.selected', { n: batchIDs.length }) }}</span
      ><button
        class="button"
        :disabled="!batchIDs.length || batchIDs.length > 50 || batchBusy"
        @click="downloadBatch"
      >
        {{ t('ops.downloadZIP') }}</button
      ><button
        class="button danger"
        :disabled="!batchIDs.length || batchBusy"
        @click="batchDeleteOpen = true"
      >
        {{ t('ops.batchDelete') }}
      </button>
    </div>
    <div ref="scroller" class="image-gallery-scroll" tabindex="0" :aria-label="t('images.gallery')">
      <div
        v-if="items.length"
        class="image-gallery-virtual"
        :style="{ height: virtual.getTotalSize() + 'px' }"
      >
        <div
          v-for="row in visible"
          :key="String(row.key)"
          :ref="measure"
          class="image-gallery-row"
          :data-index="row.index"
          :style="{
            transform: 'translateY(' + row.start + 'px)',
            gridTemplateColumns: 'repeat(' + columns + ', minmax(0,1fr))',
          }"
        >
          <article
            v-for="item in items.slice(row.index * columns, (row.index + 1) * columns)"
            :key="item.file.id"
            class="image-gallery-card panel"
          >
            <label class="checkbox-row"
              ><input
                v-model="batchIDs"
                type="checkbox"
                :value="item.file.id"
                :disabled="batchBusy"
              />{{ t('ops.select') }}</label
            >
            <button
              class="image-gallery-open"
              :aria-label="t('images.preview')"
              @click="open(item)"
            >
              <ProtectedImage :file="item.file" :alt="item.prompt" />
            </button>
            <div class="image-gallery-copy">
              <p>{{ item.prompt }}</p>
              <span
                >{{ t('images.' + item.quality) }} · {{ item.file.width }} ×
                {{ item.file.height }}</span
              >
              <div class="image-result-actions">
                <button
                  class="icon-button"
                  :aria-label="t('images.download')"
                  @click="actions.download(item.file)"
                >
                  <Download :size="15" /></button
                ><button
                  class="icon-button"
                  :aria-label="t('images.edit')"
                  @click="edit(item.file)"
                >
                  <Plus :size="15" /></button
                ><button
                  class="icon-button"
                  :aria-label="t('images.delete')"
                  @click="deleting = item"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
      <div v-else-if="!loading" class="image-gallery-empty">
        <Image :size="36" :stroke-width="1.2" />
        <h2>{{ t('images.emptyGallery') }}</h2>
        <p>{{ t('images.galleryHint') }}</p>
      </div>
      <p v-if="loading" class="loading-state" role="status">{{ t('images.loading') }}</p>
      <button v-if="cursor" class="button image-older" :disabled="loading" @click="load(true)">
        {{ t('images.more') }}
      </button>
    </div>
    <ImagePreview
      :open="preview"
      :files="items.map((i) => i.file)"
      :index="previewIndex"
      :prompt="selected?.prompt ?? ''"
      :parameters="
        selected
          ? selected.model_name + ' · ' + selected.size + ' · ' + t('images.' + selected.quality)
          : ''
      "
      @update:open="preview = $event"
      @navigate="previewIndex = $event"
      @edit="edit"
    />
    <ModalDialog
      :open="!!deleting"
      :title="t('images.deleteTitle')"
      :description="t('images.deleteHint')"
      :busy="deletingBusy"
      @update:open="deleting = undefined"
      ><ApiNotice :error="error" />
      <div class="dialog-actions">
        <button class="button" :disabled="deletingBusy" @click="deleting = undefined">
          {{ t('common.cancel') }}</button
        ><button class="button danger" :disabled="deletingBusy" @click="remove">
          {{ t('common.delete') }}
        </button>
      </div></ModalDialog
    >
  </div>
  <ModalDialog
    :open="batchDeleteOpen"
    :title="t('ops.batchDelete')"
    :description="t('ops.batchImageConfirm')"
    :busy="batchBusy"
    @update:open="batchDeleteOpen = $event"
    ><ApiNotice :error="error" /><button
      class="button danger"
      :disabled="batchBusy"
      @click="deleteBatch"
    >
      {{ t('ops.confirm') }}
    </button></ModalDialog
  >
</template>
