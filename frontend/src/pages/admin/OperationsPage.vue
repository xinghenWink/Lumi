<script setup lang="ts">
import { computed, ref, shallowRef, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  operations,
  type Dashboard,
  type Announcement,
  type OperationsSettings,
  type SystemInfo,
  type ChatMetadata,
} from '../../api/operations'
import { authorized } from '../../api/protected'
import { parseMessage, type Message } from '../../api/chat'
import { record, ApiError } from '../../api/transport'
import ApiNotice from '../../components/ApiNotice.vue'
import ModalDialog from '../../components/ModalDialog.vue'
import MarkdownContent from '../../components/chat/MarkdownContent.vue'
const route = useRoute(),
  { t } = useI18n()
const tab = computed(() => String(route.name)),
  days = ref(7),
  loading = ref(false),
  busy = ref(false),
  error = shallowRef<unknown>(),
  notice = ref('')
const dashboard = shallowRef<Dashboard>(),
  announcements = shallowRef<Announcement[]>([]),
  config = ref<OperationsSettings>(),
  system = shallowRef<SystemInfo>(),
  chats = shallowRef<ChatMetadata[]>([]),
  messages = shallowRef<Message[]>([]),
  cursor = ref(''),
  owner = ref(typeof route.query.user_id === 'string' ? route.query.user_id : '')
const secret = ref(''),
  words = ref(''),
  editing = ref(false),
  announcementID = ref(''),
  content = ref(''),
  starts = ref(''),
  ends = ref(''),
  enabled = ref(true),
  version = ref(0)
const confirming = ref<() => Promise<void>>(),
  confirmDescription = ref('')
let generation = 0
onUnmounted(() => generation++)
const title = computed(() =>
  t(
    (
      {
        'admin-dashboard': 'nav.dashboard',
        'admin-announcements': 'nav.announcements',
        'admin-system': 'nav.systemInfo',
        'admin-operations': 'nav.operations',
        'admin-chats': 'nav.adminChats',
      } as Record<string, string>
    )[tab.value] ?? 'nav.administration',
  ),
)
const columns = [
  'new_users',
  'active_users',
  'chat_messages',
  'image_success',
  'image_failed',
  'credits_granted',
  'credits_spent',
  'signup_credits',
  'daily_credits',
  'redeem_credits',
  'admin_credits',
] as const
const columnKeys = [
  'newUsers',
  'activeUsers',
  'chats',
  'success',
  'failed',
  'granted',
  'spent',
  'signupCredits',
  'dailyCredits',
  'redeemCredits',
  'adminCredits',
]
const maximum = computed(() =>
  Math.max(1, ...(dashboard.value?.days.map((d) => d.chat_messages + d.image_success) ?? [])),
)
watch(
  tab,
  () => {
    cursor.value = ''
    void load()
  },
  { immediate: true },
)
async function load(more = false) {
  const current = ++generation
  loading.value = true
  error.value = undefined
  try {
    if (tab.value === 'admin-dashboard') {
      const v = await operations.dashboard(days.value)
      if (current === generation) dashboard.value = v
    }
    if (tab.value === 'admin-system') {
      const v = await operations.system()
      if (current === generation) system.value = v
    }
    if (tab.value === 'admin-operations') {
      const v = await operations.settings()
      if (current === generation) {
        config.value = v
        words.value = v.sensitive_words.join('\n')
        secret.value = ''
      }
    }
    if (tab.value === 'admin-announcements') {
      const v = await operations.announcements(true, more ? cursor.value : '')
      if (current === generation) {
        announcements.value = more ? [...announcements.value, ...v.items] : v.items
        cursor.value = v.next_cursor
      }
    }
    if (tab.value === 'admin-chats') {
      const v = await operations.chats(
        new URLSearchParams({
          user_id: owner.value,
          cursor: more ? cursor.value : '',
          limit: '40',
        }),
      )
      if (current === generation) {
        chats.value = more ? [...chats.value, ...v.items] : v.items
        cursor.value = v.next_cursor
      }
    }
  } catch (e) {
    if (current === generation) error.value = e
  } finally {
    if (current === generation) loading.value = false
  }
}
function selectDays(value: number) {
  days.value = value
  void load()
}
async function action(fn: () => Promise<unknown>, message = 'common.saved') {
  busy.value = true
  error.value = undefined
  notice.value = ''
  try {
    await fn()
    notice.value = t(message)
  } catch (e) {
    error.value = e
  } finally {
    busy.value = false
  }
}
function confirm(fn: () => Promise<void>, description: string) {
  confirming.value = fn
  confirmDescription.value = description
}
async function confirmed() {
  const fn = confirming.value
  if (!fn) return
  await action(fn)
  confirming.value = undefined
}
function requestDelete(row: Announcement) {
  confirm(async () => {
    await operations.deleteAnnouncement(row.id)
    await load()
  }, t('ops.confirmDelete'))
}
function requestCleanup() {
  confirm(async () => {
    await operations.cleanup()
    await load()
  }, t('ops.cleanupConfirm'))
}
async function saveConfig() {
  if (!config.value) return
  const v = {
    ...config.value,
    sensitive_words: words.value
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean),
  }
  await action(async () => {
    config.value = await operations.saveSettings(v, secret.value || undefined)
    secret.value = ''
  })
}
function edit(row?: Announcement) {
  announcementID.value = row?.id ?? ''
  content.value = row?.content ?? ''
  starts.value = (row?.starts_at ?? new Date().toISOString()).slice(0, 16)
  ends.value = row?.ends_at?.slice(0, 16) ?? ''
  enabled.value = row?.enabled ?? true
  version.value = row?.version ?? 0
  editing.value = true
}
async function saveAnnouncement() {
  await action(async () => {
    await operations.saveAnnouncement(
      {
        content: content.value,
        starts_at: new Date(starts.value + 'Z').toISOString(),
        ends_at: ends.value ? new Date(ends.value + 'Z').toISOString() : null,
        enabled: enabled.value,
        version: version.value,
      },
      announcementID.value || undefined,
    )
    editing.value = false
    await load()
  })
}
async function view(row: ChatMetadata) {
  await action(async () => {
    messages.value = await authorized(
      `/api/v1/admin/conversations/${encodeURIComponent(row.id)}/messages?user_id=${encodeURIComponent(row.user_id)}&limit=100`,
      (v) => {
        const d = record(v)
        if (!Array.isArray(d.items)) throw new ApiError('RESPONSE_INVALID')
        return d.items.map(parseMessage)
      },
    )
  }, 'ops.hiddenContent')
}
</script>
<template>
  <div class="page-container ops-page">
    <div class="page-heading">
      <div>
        <h1>{{ title }}</h1>
      </div>
      <button class="button" :disabled="loading || busy" @click="load()">
        {{ t('common.refresh') }}
      </button>
    </div>
    <ApiNotice :error="error" />
    <p v-if="notice" class="success-notice" role="status">{{ notice }}</p>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <template v-if="tab === 'admin-dashboard' && dashboard">
      <div class="ops-toolbar">
        <button
          v-for="n in [1, 7, 30]"
          :key="n"
          class="button"
          :class="{ primary: days === n }"
          @click="selectDays(n)"
        >
          {{ n === 1 ? t('ops.today') : t('ops.days', { n }) }}
        </button>
      </div>
      <dl class="ops-totals panel">
        <div
          v-for="[key, value] in [
            ['users', dashboard.users],
            ['activeStreams', dashboard.active_streams],
            ['creditChanges', dashboard.credit_changes],
          ]"
          :key="String(key)"
        >
          <dt>{{ t('ops.' + key) }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
      <section class="panel ops-section">
        <h2>{{ t('ops.trend') }}</h2>
        <div class="ops-trend" role="img" :aria-label="t('ops.trend')">
          <div v-for="day in dashboard.days" :key="day.date" class="ops-trend-row">
            <span>{{ day.date.slice(5) }}</span>
            <div class="ops-bar-track">
              <div
                class="ops-bar"
                :style="{ width: (100 * (day.chat_messages + day.image_success)) / maximum + '%' }"
              />
            </div>
            <span>{{ day.chat_messages + day.image_success }}</span>
          </div>
        </div>
        <p class="muted">{{ t('ops.chats') }} + {{ t('ops.success') }}</p>
      </section>
      <div class="table-wrap panel">
        <table>
          <thead>
            <tr>
              <th>{{ t('ops.date') }}</th>
              <th v-for="key in columnKeys" :key="key">{{ t('ops.' + key) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="day in dashboard.days" :key="day.date">
              <td>{{ day.date }}</td>
              <td v-for="key in columns" :key="key">{{ day[key] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <section class="panel ops-section">
        <h2>{{ t('ops.upstreams') }}</h2>
        <p v-if="!dashboard.upstreams.length">{{ t('common.empty') }}</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ t('nav.upstreams') }}</th>
                <th>{{ t('ops.calls') }}</th>
                <th>{{ t('ops.successRate') }}</th>
                <th>{{ t('ops.latency') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in dashboard.upstreams" :key="row.id">
                <td class="mono">{{ row.id }}</td>
                <td>{{ row.calls }}</td>
                <td>{{ ((100 * row.successes) / Math.max(1, row.calls)).toFixed(1) }}%</td>
                <td>{{ row.latency_ms }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <template v-if="tab === 'admin-announcements'"
      ><button class="button primary" @click="edit()">{{ t('ops.addAnnouncement') }}</button>
      <section v-for="row in announcements" :key="row.id" class="panel ops-section">
        <MarkdownContent :content="row.content" :complete="true" />
        <p class="muted">{{ row.starts_at }} · {{ row.ends_at ?? '—' }}</p>
        <div class="ops-toolbar">
          <button class="button" @click="edit(row)">{{ t('ops.edit') }}</button
          ><button class="button danger" @click="requestDelete(row)">{{ t('ops.remove') }}</button>
        </div>
      </section>
      <p v-if="!loading && !announcements.length">{{ t('common.empty') }}</p></template
    >
    <form
      v-if="tab === 'admin-operations' && config"
      class="panel ops-section ops-form"
      @submit.prevent="saveConfig"
    >
      <label class="checkbox-row"
        ><input v-model="config.maintenance" type="checkbox" />{{ t('ops.maintenance') }}</label
      >
      <p class="muted">{{ t('ops.maintenanceHint') }}</p>
      <label class="checkbox-row"
        ><input v-model="config.turnstile_enabled" type="checkbox" />{{
          t('ops.turnstileEnabled')
        }}</label
      >
      <label
        >{{ t('ops.siteKey') }}<input v-model="config.turnstile_site_key" maxlength="200" /></label
      ><label
        >{{ t('ops.hostname') }}<input v-model="config.turnstile_hostname" maxlength="253" /></label
      ><label
        >{{ t('ops.secret')
        }}<input
          v-model="secret"
          type="password"
          autocomplete="new-password"
          maxlength="4096" /></label
      ><small v-if="config.turnstile_secret_configured">{{ t('ops.secretConfigured') }}</small>
      <label
        >{{ t('ops.registerLimit')
        }}<input
          v-model.number="config.register_per_ip_day"
          type="number"
          min="0"
          max="1000"
          required /></label
      ><label
        >{{ t('ops.circuitFailures')
        }}<input
          v-model.number="config.circuit_failures"
          type="number"
          min="1"
          max="100"
          required /></label
      ><label
        >{{ t('ops.circuitSeconds')
        }}<input
          v-model.number="config.circuit_seconds"
          type="number"
          min="1"
          max="3600"
          required /></label
      ><label>{{ t('ops.words') }}<textarea v-model="words" rows="5" /></label
      ><button class="button primary" :disabled="busy">{{ t('common.save') }}</button>
    </form>
    <section v-if="tab === 'admin-system' && system" class="panel ops-section">
      <dl class="ops-details">
        <template
          v-for="[key, value] in [
            ['version', system.version],
            ['commit', system.commit],
            ['buildTime', system.build_time],
            ['uptime', system.uptime_seconds],
            ['database', t(system.database_ok ? 'ops.ok' : 'ops.unavailable')],
            ['redis', t(system.redis_ok ? 'ops.ok' : 'ops.unavailable')],
            ['storage', (system.image_bytes / 1048576).toFixed(2) + ' MB'],
          ]"
          :key="String(key)"
          ><dt>{{ t('ops.' + key) }}</dt>
          <dd>{{ value || '—' }}</dd></template
        >
      </dl>
      <div class="ops-toolbar">
        <button class="button" :disabled="busy" @click="requestCleanup()">
          {{ t('ops.cleanup') }}</button
        ><button
          class="button"
          :disabled="busy"
          @click="action(operations.testMail, 'ops.mailSent')"
        >
          {{ t('ops.testMail') }}
        </button>
      </div>
    </section>
    <template v-if="tab === 'admin-chats'"
      ><p class="muted">{{ t('ops.hiddenContent') }}</p>
      <form class="ops-toolbar" @submit.prevent="load()">
        <input v-model="owner" :aria-label="t('ops.owner')" :placeholder="t('ops.owner')" /><button
          class="button"
        >
          {{ t('common.search') }}
        </button>
      </form>
      <div class="table-wrap panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>{{ t('ops.owner') }}</th>
              <th>{{ t('ops.lastMessage') }}</th>
              <th>{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in chats" :key="row.id">
              <td>{{ row.id }}</td>
              <td>{{ row.user_id }}</td>
              <td>{{ row.last_message_at }}</td>
              <td>
                <button class="button" @click="view(row)">{{ t('ops.viewContent') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section v-if="messages.length" class="panel ops-section">
        <article v-for="message in messages" :key="message.id">
          <strong>{{ message.role }}</strong
          ><MarkdownContent :content="message.content" :complete="true" />
        </article></section
    ></template>
    <button v-if="cursor" class="button" :disabled="loading" @click="load(true)">
      {{ t('images.more') }}
    </button>
    <ModalDialog
      :open="editing"
      :title="t('ops.addAnnouncement')"
      :description="t('ops.content')"
      :busy="busy"
      @update:open="editing = $event"
      ><form class="ops-form" @submit.prevent="saveAnnouncement">
        <label
          >{{ t('ops.content')
          }}<textarea v-model="content" rows="7" maxlength="10000" required /></label
        ><label
          >{{ t('ops.startsAt') }}<input v-model="starts" type="datetime-local" required /></label
        ><label>{{ t('ops.endsAt') }}<input v-model="ends" type="datetime-local" /></label
        ><label class="checkbox-row"
          ><input v-model="enabled" type="checkbox" />{{ t('ops.enabled') }}</label
        ><ApiNotice :error="error" /><button class="button primary" :disabled="busy">
          {{ t('common.save') }}
        </button>
      </form></ModalDialog
    >
    <ModalDialog
      :open="!!confirming"
      :title="t('ops.confirm')"
      :description="confirmDescription"
      :busy="busy"
      @update:open="confirming = undefined"
      ><ApiNotice :error="error" />
      <div class="dialog-actions">
        <button class="button" :disabled="busy" @click="confirming = undefined">
          {{ t('common.cancel') }}</button
        ><button class="button danger" :disabled="busy" @click="confirmed">
          {{ t('ops.confirm') }}
        </button>
      </div></ModalDialog
    >
  </div>
</template>
