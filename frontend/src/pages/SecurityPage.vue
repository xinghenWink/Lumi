<script setup lang="ts">
import { onMounted, ref, shallowRef, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { operations, type Preferences, type Device } from '../api/operations'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import ApiNotice from '../components/ApiNotice.vue'
import ModalDialog from '../components/ModalDialog.vue'
const { t } = useI18n(),
  auth = useAuthStore(),
  theme = useThemeStore(),
  router = useRouter()
const preferences = ref<Preferences>(),
  devices = shallowRef<Device[]>([]),
  current = ref(''),
  busy = ref(false),
  loading = ref(true),
  error = shallowRef<unknown>(),
  notice = ref(''),
  deleteOpen = ref(false),
  email = ref(''),
  password = ref(''),
  revokeID = ref('')
let alive = true
onUnmounted(() => {
  alive = false
  password.value = ''
})
onMounted(() => void load())
async function load() {
  loading.value = true
  error.value = undefined
  try {
    const [p, d] = await Promise.all([operations.preferences(), operations.devices()])
    if (alive) {
      preferences.value = p
      devices.value = d.items
      current.value = d.current_id
    }
  } catch (e) {
    if (alive) error.value = e
  } finally {
    if (alive) loading.value = false
  }
}
async function action(fn: () => Promise<void>) {
  busy.value = true
  error.value = undefined
  notice.value = ''
  try {
    await fn()
  } catch (e) {
    if (alive) error.value = e
  } finally {
    if (alive) busy.value = false
  }
}
async function save() {
  if (!preferences.value) return
  const p = preferences.value
  await action(async () => {
    const saved = await operations.savePreferences(p)
    if (alive) {
      preferences.value = saved
      theme.set(saved.theme)
      notice.value = t('common.saved')
    }
  })
}
async function revoke() {
  const id = revokeID.value
  await action(async () => {
    await operations.revoke(id)
    if (id === current.value) {
      auth.clear()
      await router.replace('/login')
    } else {
      revokeID.value = ''
      await load()
    }
  })
}
async function remove() {
  await action(async () => {
    await operations.deleteSelf(email.value, password.value)
    password.value = ''
    auth.clear()
    await router.replace('/login')
  })
}
async function exportChats(format: 'json' | 'markdown') {
  await action(async () => {
    await operations.exportChats(format)
  })
}
</script>
<template>
  <div class="page-container ops-page">
    <div class="page-heading">
      <h1>{{ t('nav.security') }}</h1>
    </div>
    <ApiNotice :error="error" />
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <button v-if="error && !preferences" class="button" @click="load">
      {{ t('common.retry') }}
    </button>
    <section v-if="preferences" class="panel ops-section">
      <h2>{{ t('ops.preferences') }}</h2>
      <form class="ops-form" @submit.prevent="save">
        <label
          >{{ t('ops.theme')
          }}<select v-model="preferences.theme">
            <option v-for="value in ['light', 'dark', 'system']" :key="value" :value="value">
              {{ t('ops.' + value) }}
            </option>
          </select></label
        ><label
          >{{ t('ops.instructions')
          }}<textarea v-model="preferences.instructions" rows="5" maxlength="4000" />
        </label>
        <p class="muted">{{ t('ops.instructionsHint') }}</p>
        <label
          >{{ t('ops.imageQuality')
          }}<select v-model="preferences.image_quality">
            <option v-for="quality in ['low', 'medium', 'high']" :key="quality" :value="quality">
              {{ t('images.' + quality) }}
            </option>
          </select></label
        ><label
          >{{ t('ops.imageRatio')
          }}<select v-model="preferences.image_ratio">
            <option
              v-for="ratio in ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16']"
              :key="ratio"
            >
              {{ ratio }}
            </option>
          </select></label
        ><label
          >{{ t('ops.imageCount')
          }}<input
            v-model.number="preferences.image_count"
            type="number"
            min="1"
            max="4"
            required /></label
        ><button class="button primary" :disabled="busy">{{ t('common.save') }}</button>
      </form>
    </section>
    <section class="panel ops-section">
      <h2>{{ t('ops.devices') }}</h2>
      <article v-for="device in devices" :key="device.id" class="ops-device">
        <div>
          <strong
            >{{ device.device }}
            <small v-if="device.id === current">{{ t('ops.currentDevice') }}</small></strong
          >
          <p class="muted">{{ device.ip }} · {{ new Date(device.created_at).toLocaleString() }}</p>
        </div>
        <button class="button" :disabled="busy" @click="revokeID = device.id">
          {{ t('ops.revoke') }}
        </button>
      </article>
    </section>
    <section class="panel ops-section">
      <h2>{{ t('ops.export') }}</h2>
      <p class="muted">{{ t('ops.exportHint') }}</p>
      <div class="ops-toolbar">
        <button class="button" :disabled="busy" @click="exportChats('json')">
          {{ t('ops.exportJSON') }}</button
        ><button class="button" :disabled="busy" @click="exportChats('markdown')">
          {{ t('ops.exportMarkdown') }}
        </button>
      </div>
    </section>
    <section class="panel ops-section">
      <h2>{{ t('ops.deleteAccount') }}</h2>
      <p>{{ t('ops.deleteAccountHint') }}</p>
      <button class="button danger" @click="deleteOpen = true">{{ t('ops.deleteAccount') }}</button>
    </section>
    <ModalDialog
      :open="deleteOpen"
      :title="t('ops.deleteAccount')"
      :description="t('ops.deleteAccountHint')"
      :busy="busy"
      @update:open="deleteOpen = $event"
      ><form class="ops-form" @submit.prevent="remove">
        <label
          >{{ t('ops.confirmEmail')
          }}<input v-model="email" type="email" autocomplete="email" required /></label
        ><label
          >{{ t('ops.password')
          }}<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required /></label
        ><ApiNotice :error="error" /><button
          class="button danger"
          :disabled="busy || email !== auth.user?.email || !password"
        >
          {{ t('ops.confirm') }}
        </button>
      </form></ModalDialog
    >
    <ModalDialog
      :open="!!revokeID"
      :title="t('ops.revoke')"
      :description="t('ops.revokeConfirm')"
      :busy="busy"
      @update:open="revokeID = ''"
      ><ApiNotice :error="error" /><button class="button danger" :disabled="busy" @click="revoke">
        {{ t('ops.confirm') }}
      </button></ModalDialog
    >
  </div>
</template>
