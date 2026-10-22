<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Copy, Plus, RotateCcw, Trash2, Info } from 'lucide-vue-next'
import { images, terminal, type ImageTask, type ImageFile } from '../../api/images'
import { useImageActions } from '../../features/images/actions'
import { useAuthStore } from '../../stores/auth'
import { ApiError } from '../../api/transport'
import ApiNotice from '../ApiNotice.vue'
import ModalDialog from '../ModalDialog.vue'
import ProtectedImage from './ProtectedImage.vue'
import ImagePreview from './ImagePreview.vue'
const props = defineProps<{ task: ImageTask; admin?: boolean }>()
const emit = defineEmits<{
  cancel: [ImageTask]
  reuse: [ImageTask]
  edit: [ImageFile]
  changed: []
}>()
const { t } = useI18n(),
  auth = useAuthStore(),
  actions = useImageActions()
const preview = ref(false),
  previewIndex = ref(0),
  details = ref(false),
  deleting = ref<ImageFile>(),
  busy = ref(false)
const error = shallowRef<unknown>(),
  references = shallowRef<ImageFile[]>([])
const files = computed(() => props.task.items.flatMap((i) => (i.file ? [i.file] : [])))
const parameters = computed(() =>
  [
    props.task.model_name,
    t('images.' + props.task.quality),
    props.task.size,
    props.task.ratio,
    props.task.n + '×',
  ]
    .filter(Boolean)
    .join(' · '),
)
watch(
  [
    () => props.task.reference_file_ids.join(','),
    () => props.task.content_visible,
    () => auth.user?.id,
  ],
  async (_, __, cleanup) => {
    references.value = []
    if (!props.task.content_visible || !auth.user) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    const results = await Promise.allSettled(
      props.task.reference_file_ids.map((id) => images.file(id, controller.signal)),
    )
    if (!controller.signal.aborted)
      references.value = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  },
  { immediate: true },
)
async function remove() {
  if (!deleting.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    await images.removeFile(deleting.value.id, props.admin)
    deleting.value = undefined
    emit('changed')
  } catch (e) {
    error.value = e
  } finally {
    busy.value = false
  }
}
function open(file: ImageFile) {
  previewIndex.value = files.value.findIndex((f) => f.id === file.id)
  preview.value = true
}
</script>
<template>
  <article class="image-task" :data-task-id="task.id">
    <div class="image-task-prompt">
      <p v-if="task.content_visible">{{ task.prompt }}</p>
      <p v-else class="field-hint">{{ t('images.hidden') }}</p>
      <div class="image-task-parameters">{{ parameters }}</div>
      <div v-if="references.length" class="image-task-references">
        <ProtectedImage
          v-for="file in references"
          :key="file.id"
          :file="file"
          :alt="t('images.references')"
        />
      </div>
    </div>
    <div class="image-task-meta">
      <span class="image-status" :class="'status-' + task.status" role="status">{{
        t('images.' + task.status)
      }}</span
      ><span v-if="task.status === 'queued'">{{
        t('images.queue', { position: task.queue_position })
      }}</span
      ><span>{{
        t(terminal(task.status) ? 'images.actual' : 'images.reserved', {
          cost: terminal(task.status) ? task.actual_cost : task.total_cost,
        })
      }}</span
      ><span v-if="task.refunded_cost">{{ t('images.refund', { cost: task.refunded_cost }) }}</span
      ><button
        v-if="!admin && !terminal(task.status)"
        class="text-button"
        :disabled="task.cancel_requested"
        @click="emit('cancel', task)"
      >
        {{ t(task.cancel_requested ? 'images.cancelRequested' : 'images.cancel') }}
      </button>
    </div>
    <div
      v-if="task.content_visible"
      class="image-result-grid"
      :class="{ 'single-result': task.n === 1 }"
    >
      <div v-for="item in task.items" :key="item.position" class="image-result">
        <template v-if="item.file">
          <button
            class="image-result-open"
            :aria-label="t('images.preview') + ' ' + (item.position + 1)"
            @click="open(item.file)"
          >
            <ProtectedImage
              :file="item.file"
              :alt="t('images.result', { index: item.position + 1 })"
            />
          </button>
          <div class="image-result-actions">
            <button
              class="icon-button"
              :aria-label="t('images.download')"
              @click="actions.download(item.file)"
            >
              <Download :size="15" /></button
            ><button
              class="icon-button"
              :aria-label="t('images.copy')"
              @click="actions.copy(item.file)"
            >
              <Copy :size="15" /></button
            ><button
              v-if="!admin"
              class="icon-button"
              :aria-label="t('images.edit')"
              @click="emit('edit', item.file)"
            >
              <Plus :size="15" /></button
            ><button
              class="icon-button"
              :aria-label="t('images.delete')"
              @click="deleting = item.file"
            >
              <Trash2 :size="15" />
            </button>
          </div>
        </template>
        <div
          v-else
          class="image-result-placeholder"
          :class="{ 'is-pending': item.status === 'pending' }"
          role="status"
        >
          {{
            t(
              item.status === 'pending'
                ? 'images.pending'
                : item.status === 'succeeded'
                  ? 'images.fileMissing'
                  : 'images.failed',
            )
          }}
        </div>
      </div>
    </div>
    <ApiNotice v-if="task.error_code" :error="new ApiError(task.error_code)" />
    <ApiNotice :error="actions.error.value || error" />
    <p v-if="actions.copied.value" class="field-hint" role="status">{{ t('images.copied') }}</p>
    <div class="image-task-footer">
      <button
        v-if="!admin && terminal(task.status)"
        class="text-button"
        @click="emit('reuse', task)"
      >
        <RotateCcw :size="14" />{{ t('images.regenerate') }}</button
      ><button class="text-button" @click="details = true">
        <Info :size="14" />{{ t('images.details') }}
      </button>
    </div>
    <ImagePreview
      :open="preview"
      :files="files"
      :index="previewIndex"
      :prompt="task.prompt"
      :parameters="parameters"
      @update:open="preview = $event"
      @edit="emit('edit', $event)"
    />
    <ModalDialog
      :open="details"
      :title="t('images.details')"
      :description="parameters"
      @update:open="details = $event"
      ><dl class="image-detail-list">
        <dt>{{ t('images.task') }}</dt>
        <dd>{{ task.id }}</dd>
        <dt>{{ t('images.user') }}</dt>
        <dd>{{ task.user_id }}</dd>
        <dt>{{ t('images.created') }}</dt>
        <dd>{{ new Date(task.created_at).toLocaleString() }}</dd>
        <dt>{{ t('images.operation') }}</dt>
        <dd>{{ t(task.operation === 'edit' ? 'images.editOperation' : 'images.generate') }}</dd>
        <dt>{{ t('images.status') }}</dt>
        <dd>{{ t('images.' + task.status) }}</dd>
        <dt>{{ t('images.actual', { cost: task.actual_cost }) }}</dt>
        <dd>{{ t('images.refund', { cost: task.refunded_cost }) }}</dd>
      </dl>
      <p v-if="task.started_at && task.finished_at" class="field-hint">
        {{
          t('images.duration', {
            seconds: Math.max(
              0,
              (Date.parse(task.finished_at) - Date.parse(task.started_at)) / 1000,
            ).toFixed(1),
          })
        }}
      </p></ModalDialog
    >
    <ModalDialog
      :open="!!deleting"
      :title="t('images.deleteTitle')"
      :description="t('images.deleteHint')"
      :busy="busy"
      @update:open="deleting = undefined"
      ><ApiNotice :error="error" />
      <div class="dialog-actions">
        <button class="button" :disabled="busy" @click="deleting = undefined">
          {{ t('common.cancel') }}</button
        ><button class="button danger" :disabled="busy" @click="remove">
          {{ t('common.delete') }}
        </button>
      </div></ModalDialog
    >
  </article>
</template>
