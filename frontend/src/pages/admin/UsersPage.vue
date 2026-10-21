<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, Users } from 'lucide-vue-next'
import { accounts } from '../../api/accounts'
import type { User, UserPage, UpdateUserInput } from '../../api/contracts'
import { useAuthStore } from '../../stores/auth'
import { addDateRange, validEmail, validPassword } from '../../features/accounts/utils'
import { useTime } from '../../features/accounts/time'
import ApiNotice from '../../components/ApiNotice.vue'
import ModalDialog from '../../components/ModalDialog.vue'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const formatTime = useTime()
const filters = reactive({
  search: '',
  role: '',
  status: '',
  sort: 'created_at',
  from: '',
  until: '',
})
const page = shallowRef<UserPage | null>(null)
const loading = ref(false)
const error = shallowRef<unknown>(null)
const notice = ref('')
const cursors = ref([''])
const pageNumber = computed(() => cursors.value.length)
let controller: AbortController | null = null
let generation = 0
const modalOpen = ref(false)
const mode = ref<'create' | 'edit' | 'delete'>('create')
const selected = shallowRef<User | null>(null)
const form = reactive({
  email: '',
  nickname: '',
  password: '',
  role: 'user' as User['role'],
  status: 'active' as User['status'],
})
const confirmation = ref('')
const busy = ref(false)
const rowBusy = ref('')
const modalError = shallowRef<unknown>(null)
const validation = ref('')
const self = computed(() => selected.value?.id === auth.user?.id)
onMounted(() => void load())
onUnmounted(() => controller?.abort())

async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  try {
    const query = new URLSearchParams({
      search: filters.search.trim(),
      role: filters.role,
      status: filters.status,
      sort: filters.sort,
      limit: '20',
      cursor: cursors.value.at(-1) ?? '',
    })
    addDateRange(query, filters.from, filters.until)
    const result = await accounts.list(query, controller.signal)
    if (current === generation) page.value = result
  } catch (failure) {
    if (
      current === generation &&
      !(failure instanceof DOMException && failure.name === 'AbortError')
    ) {
      error.value = failure
      page.value = null
    }
  } finally {
    if (current === generation) loading.value = false
  }
}
function search() {
  cursors.value = ['']
  void load()
}
function reset() {
  Object.assign(filters, {
    search: '',
    role: '',
    status: '',
    sort: 'created_at',
    from: '',
    until: '',
  })
  search()
}
function next() {
  if (page.value?.next_cursor) {
    cursors.value = [...cursors.value, page.value.next_cursor]
    void load()
  }
}
function previous() {
  if (cursors.value.length > 1) {
    cursors.value = cursors.value.slice(0, -1)
    void load()
  }
}
function open(value: 'create' | 'edit' | 'delete', user: User | null = null) {
  mode.value = value
  selected.value = user
  modalError.value = null
  validation.value = ''
  confirmation.value = ''
  Object.assign(form, {
    email: user?.email ?? '',
    nickname: user?.nickname ?? '',
    password: '',
    role: user?.role ?? 'user',
    status: user?.status ?? 'active',
  })
  modalOpen.value = true
}
async function save() {
  validation.value = ''
  modalError.value = null
  if (mode.value !== 'delete') {
    if (!validEmail(form.email.trim())) {
      validation.value = t('auth.emailInvalid')
      return
    }
    if (!form.nickname.trim() || Array.from(form.nickname.trim()).length > 30) {
      validation.value = t('auth.nicknameInvalid')
      return
    }
    if ((mode.value === 'create' || form.password) && !validPassword(form.password)) {
      validation.value = t('auth.passwordInvalid')
      return
    }
  }
  busy.value = true
  try {
    if (mode.value === 'create') {
      await accounts.create({
        email: form.email.trim(),
        nickname: form.nickname.trim(),
        password: form.password,
        role: form.role,
      })
      notice.value = t('admin.users.createSuccess')
    } else if (selected.value && mode.value === 'edit') {
      const before = selected.value
      const input: UpdateUserInput = {
        email: form.email.trim(),
        nickname: form.nickname.trim(),
        role: form.role,
        status: form.status,
        ...(form.password ? { password: form.password } : {}),
      }
      const result = await accounts.update(before.id, input)
      if (result.id === auth.user?.id) {
        if (before.email !== result.email || form.password) {
          modalOpen.value = false
          auth.clear()
          await router.replace('/login')
          return
        }
        auth.updateUser(result)
      }
      notice.value = t('admin.users.updateSuccess')
    } else if (selected.value) {
      await accounts.delete(selected.value.id, confirmation.value.trim())
      notice.value = t('admin.users.deleteSuccess')
    }
    modalOpen.value = false
    form.password = ''
    await load()
  } catch (failure) {
    modalError.value = failure
  } finally {
    busy.value = false
  }
}
async function toggle(user: User) {
  rowBusy.value = user.id
  error.value = null
  notice.value = ''
  try {
    await accounts.update(user.id, { status: user.status === 'active' ? 'disabled' : 'active' })
    notice.value = t('admin.users.statusSuccess')
    await load()
  } catch (failure) {
    error.value = failure
  } finally {
    rowBusy.value = ''
  }
}
</script>

<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('admin.users.title') }}</h1>
        <p>{{ t('admin.users.description') }}</p>
      </div>
      <button class="button primary" @click="open('create')">
        <Plus :size="17" />{{ t('admin.users.new') }}
      </button>
    </div>
    <form class="filter-panel" @submit.prevent="search">
      <div class="search-field">
        <Search :size="17" aria-hidden="true" /><input
          v-model="filters.search"
          type="search"
          maxlength="254"
          :aria-label="t('admin.users.searchPlaceholder')"
          :placeholder="t('admin.users.searchPlaceholder')"
        />
      </div>
      <select v-model="filters.role" :aria-label="t('admin.users.role')" @change="search">
        <option value="">{{ t('admin.users.allRoles') }}</option>
        <option value="user">{{ t('admin.users.user') }}</option>
        <option value="admin">{{ t('admin.users.admin') }}</option></select
      ><select v-model="filters.status" :aria-label="t('admin.users.status')" @change="search">
        <option value="">{{ t('admin.users.allStatuses') }}</option>
        <option value="active">{{ t('admin.users.active') }}</option>
        <option value="disabled">{{ t('admin.users.disabled') }}</option></select
      ><select v-model="filters.sort" :aria-label="t('admin.users.newest')" @change="search">
        <option value="created_at">{{ t('admin.users.newest') }}</option>
        <option value="last_login_at">{{ t('admin.users.lastLoginSort') }}</option></select
      ><button class="button" type="submit">{{ t('common.search') }}</button>
      <div class="date-filters">
        <label>{{ t('common.from') }}<input v-model="filters.from" type="date" /></label
        ><label>{{ t('common.until') }}<input v-model="filters.until" type="date" /></label
        ><span class="field-hint">{{ t('common.filterUTC') }}</span
        ><button class="text-button" type="button" @click="reset">{{ t('common.reset') }}</button>
      </div>
    </form>
    <ApiNotice :error="error" />
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
    <div class="panel data-panel" :aria-busy="loading">
      <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="error && !page" class="empty-state">
        <button class="button" @click="load">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!page?.items.length" class="empty-state">
        <Users :size="30" />
        <h2>{{ t('admin.users.emptyTitle') }}</h2>
        <p>{{ t('admin.users.emptyDescription') }}</p>
      </div>
      <template v-else
        ><div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ t('admin.users.identity') }}</th>
                <th>{{ t('admin.users.role') }}</th>
                <th>{{ t('admin.users.status') }}</th>
                <th>{{ t('admin.users.registered') }}</th>
                <th>{{ t('admin.users.lastLogin') }}</th>
                <th>{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in page.items" :key="user.id">
                <td>
                  <RouterLink class="identity-link" :to="`/admin/users/${user.id}`"
                    ><span class="small-avatar">{{ Array.from(user.nickname)[0] }}</span
                    ><span
                      ><strong>{{ user.nickname }}</strong
                      ><span>{{ user.email }}</span
                      ><code class="user-id">{{ user.id }}</code></span
                    ></RouterLink
                  >
                </td>
                <td>
                  <span class="badge" :class="{ purple: user.role === 'admin' }">{{
                    t(`admin.users.${user.role}`)
                  }}</span>
                </td>
                <td>
                  <span class="badge" :class="user.status === 'active' ? 'green' : 'red'"
                    ><span class="status-dot" />{{ t(`admin.users.${user.status}`) }}</span
                  >
                </td>
                <td class="nowrap">{{ formatTime(user.created_at) }}</td>
                <td>
                  <span class="nowrap">{{
                    user.last_login_at ? formatTime(user.last_login_at) : t('common.never')
                  }}</span
                  ><span class="table-secondary">{{ user.last_login_ip }}</span>
                </td>
                <td>
                  <div class="row-actions">
                    <button
                      class="icon-button"
                      :aria-label="`${t('admin.users.edit')} ${user.email}`"
                      @click="open('edit', user)"
                    >
                      <Pencil :size="16" /></button
                    ><button
                      class="text-button"
                      :disabled="user.id === auth.user?.id || rowBusy === user.id"
                      :aria-label="`${t(user.status === 'active' ? 'admin.users.disable' : 'admin.users.enable')} ${user.email}`"
                      @click="toggle(user)"
                    >
                      {{
                        t(user.status === 'active' ? 'admin.users.disable' : 'admin.users.enable')
                      }}</button
                    ><button
                      class="icon-button danger-text"
                      :disabled="user.id === auth.user?.id"
                      :aria-label="`${t('admin.users.delete')} ${user.email}`"
                      @click="open('delete', user)"
                    >
                      <Trash2 :size="16" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div v-if="page && !loading" class="pagination">
        <span>{{ t('common.page', { page: pageNumber }) }}</span>
        <div>
          <button class="button compact" :disabled="pageNumber === 1 || loading" @click="previous">
            <ChevronLeft :size="15" />{{ t('common.previous') }}</button
          ><button class="button compact" :disabled="!page.next_cursor || loading" @click="next">
            {{ t('common.next') }}<ChevronRight :size="15" />
          </button>
        </div>
      </div>
    </div>
    <ModalDialog
      v-model:open="modalOpen"
      :busy="busy"
      :title="
        t(
          mode === 'create'
            ? 'admin.users.new'
            : mode === 'edit'
              ? 'admin.users.edit'
              : 'admin.users.delete',
        )
      "
      :description="
        t(
          mode === 'create'
            ? 'admin.users.createDescription'
            : mode === 'edit'
              ? 'admin.users.editDescription'
              : 'admin.users.deleteDescription',
        )
      "
    >
      <form class="stack" @submit.prevent="save">
        <template v-if="mode !== 'delete'"
          ><label class="field"
            >{{ t('auth.email')
            }}<input
              v-model="form.email"
              type="email"
              name="email"
              maxlength="254"
              required
              :disabled="busy" /></label
          ><label class="field"
            >{{ t('auth.nickname')
            }}<input
              v-model="form.nickname"
              name="nickname"
              maxlength="30"
              required
              :disabled="busy" /></label
          ><label class="field"
            >{{ t('auth.password')
            }}<input
              v-model="form.password"
              type="password"
              name="password"
              autocomplete="new-password"
              maxlength="128"
              :required="mode === 'create'"
              :placeholder="
                t(mode === 'edit' ? 'admin.users.passwordOptional' : 'auth.passwordHint')
              "
              :disabled="busy"
          /></label>
          <div class="form-grid">
            <label class="field"
              >{{ t('admin.users.role')
              }}<select v-model="form.role" :disabled="busy || self">
                <option value="user">{{ t('admin.users.user') }}</option>
                <option value="admin">{{ t('admin.users.admin') }}</option>
              </select></label
            ><label v-if="mode === 'edit'" class="field"
              >{{ t('admin.users.status')
              }}<select v-model="form.status" :disabled="busy || self">
                <option value="active">{{ t('admin.users.active') }}</option>
                <option value="disabled">{{ t('admin.users.disabled') }}</option>
              </select></label
            >
          </div>
          <p v-if="self" class="field-hint">{{ t('admin.users.selfProtected') }}</p></template
        ><template v-else
          ><div class="deletion-target">{{ selected?.email }}</div>
          <label class="field"
            >{{ t('admin.users.deleteConfirm')
            }}<input
              v-model="confirmation"
              type="email"
              name="confirmation"
              autocomplete="off"
              required
              :disabled="busy" /></label
        ></template>
        <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
        <ApiNotice :error="modalError" />
        <div class="dialog-actions">
          <button class="button" type="button" :disabled="busy" @click="modalOpen = false">
            {{ t('common.cancel') }}</button
          ><button
            class="button"
            :class="mode === 'delete' ? 'danger' : 'primary'"
            :disabled="
              busy ||
              (mode === 'delete' &&
                confirmation.trim().toLowerCase() !== selected?.email.toLowerCase())
            "
          >
            {{
              t(
                busy
                  ? 'common.saving'
                  : mode === 'create'
                    ? 'admin.users.createAction'
                    : mode === 'delete'
                      ? 'admin.users.deleteAction'
                      : 'common.save',
              )
            }}
          </button>
        </div>
      </form>
    </ModalDialog>
  </div>
</template>
