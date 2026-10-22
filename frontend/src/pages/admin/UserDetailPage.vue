<script setup lang="ts">
import { onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Copy } from 'lucide-vue-next'
import { accounts } from '../../api/accounts'
import type { UserDetail } from '../../api/contracts'
import { useTime } from '../../features/accounts/time'
import ApiNotice from '../../components/ApiNotice.vue'
const route = useRoute()
const { t } = useI18n()
const formatTime = useTime()
const data = shallowRef<UserDetail | null>(null)
const loading = ref(false)
const error = shallowRef<unknown>(null)
const notice = ref('')
let controller: AbortController | null = null
let generation = 0
watch(
  () => route.params.id,
  () => void load(),
  { immediate: true },
)
onUnmounted(() => controller?.abort())
async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  try {
    const result = await accounts.detail(String(route.params.id), controller.signal)
    if (current === generation) data.value = result
  } catch (failure) {
    if (
      current === generation &&
      !(failure instanceof DOMException && failure.name === 'AbortError')
    )
      error.value = failure
  } finally {
    if (current === generation) loading.value = false
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(data.value?.user.id ?? '')
    notice.value = t('common.copied')
  } catch {
    notice.value = t('common.copyFailed')
  }
}
</script>
<template>
  <div class="page-container">
    <RouterLink class="back-link" to="/admin/users"
      ><ArrowLeft :size="16" />{{ t('admin.users.title') }}</RouterLink
    >
    <div class="page-heading">
      <div>
        <h1>{{ data?.user.nickname ?? t('admin.users.profileTab') }}</h1>
        <p>{{ t('admin.users.detailDescription') }}</p>
      </div>
    </div>
    <ApiNotice :error="error" />
    <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
    <button v-else-if="error" class="button" @click="load">{{ t('common.retry') }}</button
    ><template v-else-if="data"
      ><section class="panel">
        <div class="panel-title">
          <h2>{{ t('admin.users.profileTab') }}</h2>
        </div>
        <dl class="detail-grid">
          <div>
            <dt>{{ t('auth.email') }}</dt>
            <dd>{{ data.user.email }}</dd>
          </div>
          <div>
            <dt>{{ t('admin.users.id') }}</dt>
            <dd class="id-copy">
              <code>{{ data.user.id }}</code
              ><button class="icon-button" :aria-label="t('common.copyId')" @click="copy">
                <Copy :size="15" />
              </button>
            </dd>
          </div>
          <div>
            <dt>{{ t('admin.users.role') }}</dt>
            <dd>{{ t(`admin.users.${data.user.role}`) }}</dd>
          </div>
          <div>
            <dt>{{ t('admin.users.status') }}</dt>
            <dd>
              <span class="badge" :class="data.user.status === 'active' ? 'green' : 'red'">{{
                t(`admin.users.${data.user.status}`)
              }}</span>
            </dd>
          </div>
          <div>
            <dt>{{ t('admin.users.registered') }}</dt>
            <dd>{{ formatTime(data.user.created_at) }}</dd>
          </div>
          <div>
            <dt>{{ t('admin.users.lastLogin') }}</dt>
            <dd>
              {{
                data.user.last_login_at ? formatTime(data.user.last_login_at) : t('common.never')
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t('admin.users.ip') }}</dt>
            <dd>{{ data.user.last_login_ip || t('common.none') }}</dd>
          </div>
          <div>
            <dt>{{ t('profile.timezone') }}</dt>
            <dd>{{ data.user.timezone }}</dd>
          </div>
        </dl>
        <p v-if="notice" class="panel-notice" role="status">{{ notice }}</p>
      </section>
      <section class="panel data-panel">
        <div class="panel-title">
          <h2>{{ t('admin.users.sessions') }}</h2>
          <p>{{ t('admin.users.sessionsDescription') }}</p>
        </div>
        <div v-if="!data.sessions.length" class="empty-state">
          {{ t('admin.users.noSessions') }}
        </div>
        <div v-else class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ t('admin.users.device') }}</th>
                <th>{{ t('audit.ip') }}</th>
                <th>{{ t('admin.users.sessionCreated') }}</th>
                <th>{{ t('admin.users.expires') }}</th>
                <th>{{ t('admin.users.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in data.sessions" :key="session.id">
                <td :title="session.user_agent">{{ session.device }}</td>
                <td>{{ session.ip }}</td>
                <td class="nowrap">{{ formatTime(session.created_at) }}</td>
                <td class="nowrap">{{ formatTime(session.expires_at) }}</td>
                <td>
                  <span
                    class="badge"
                    :class="
                      session.revoked_at || new Date(session.expires_at).getTime() < Date.now()
                        ? ''
                        : 'green'
                    "
                    >{{
                      t(
                        session.revoked_at
                          ? 'admin.users.revoked'
                          : new Date(session.expires_at).getTime() < Date.now()
                            ? 'admin.users.expired'
                            : 'admin.users.sessionActive',
                      )
                    }}</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section></template
    >
  </div>
</template>
