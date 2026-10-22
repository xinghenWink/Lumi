<script setup lang="ts">
import { onMounted, reactive, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { accounts } from '../api/accounts'
import { useAuthStore } from '../stores/auth'
import { useThemeStore, type Theme } from '../stores/theme'
import { validPassword } from '../features/accounts/utils'
import ApiNotice from '../components/ApiNotice.vue'
const { t, locale } = useI18n()
const auth = useAuthStore()
const theme = useThemeStore()
const router = useRouter()
const form = reactive({
  nickname: '',
  locale: 'zh-CN' as 'zh-CN' | 'en',
  timezone: 'Asia/Shanghai',
})
const password = reactive({ current: '', next: '', confirm: '' })
const busy = ref(false)
const passwordBusy = ref(false)
const error = shallowRef<unknown>(null)
const passwordError = shallowRef<unknown>(null)
const validation = ref('')
const passwordValidation = ref('')
const notice = ref('')
onMounted(() => {
  if (auth.user) {
    form.nickname = auth.user.nickname
    form.locale = auth.user.locale
    form.timezone = auth.user.timezone
  }
})
async function save() {
  error.value = null
  validation.value = ''
  notice.value = ''
  if (!form.nickname.trim() || Array.from(form.nickname.trim()).length > 30) {
    validation.value = t('auth.nicknameInvalid')
    return
  }
  busy.value = true
  try {
    const user = await accounts.updateMe({
      nickname: form.nickname.trim(),
      locale: form.locale,
      timezone: form.timezone,
    })
    auth.updateUser(user)
    locale.value = user.locale
    notice.value = t('common.saved')
  } catch (failure) {
    error.value = failure
  } finally {
    busy.value = false
  }
}
async function changePassword() {
  passwordError.value = null
  passwordValidation.value = ''
  if (!validPassword(password.next)) {
    passwordValidation.value = t('auth.passwordInvalid')
    return
  }
  if (password.next !== password.confirm) {
    passwordValidation.value = t('profile.mismatch')
    return
  }
  if (!password.current) {
    passwordValidation.value = t('common.required')
    return
  }
  passwordBusy.value = true
  try {
    await accounts.password({ current_password: password.current, new_password: password.next })
    password.current = ''
    password.next = ''
    password.confirm = ''
    auth.clear()
    await router.replace({ name: 'login', query: { changed: '1' } })
  } catch (failure) {
    passwordError.value = failure
  } finally {
    passwordBusy.value = false
  }
}
function setTheme(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'light' || value === 'dark' || value === 'system') theme.set(value as Theme)
}
</script>
<template>
  <div class="page-container profile-page">
    <div class="page-heading">
      <div>
        <h1>{{ t('profile.title') }}</h1>
        <p>{{ t('profile.description') }}</p>
      </div>
    </div>
    <section class="panel">
      <div class="panel-title">
        <h2>{{ t('profile.basics') }}</h2>
      </div>
      <form class="panel-body stack" @submit.prevent="save">
        <label class="field"
          >{{ t('auth.nickname')
          }}<input
            v-model="form.nickname"
            name="nickname"
            maxlength="30"
            required
            :disabled="busy" /></label
        ><label class="field"
          >{{ t('auth.email') }}<input :value="auth.user?.email" type="email" readonly /><span
            class="field-hint"
            >{{ t('profile.emailReadonly') }}</span
          ></label
        >
        <div class="form-grid">
          <label class="field"
            >{{ t('common.locale')
            }}<select v-model="form.locale" :disabled="busy">
              <option value="zh-CN">{{ t('common.zhCN') }}</option>
              <option value="en">{{ t('common.en') }}</option>
            </select></label
          ><label class="field"
            >{{ t('profile.timezone')
            }}<input
              v-model="form.timezone"
              name="timezone"
              maxlength="100"
              required
              :disabled="busy"
          /></label>
        </div>
        <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
        <ApiNotice :error="error" />
        <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
        <div>
          <button class="button primary" :disabled="busy">
            {{ t(busy ? 'common.saving' : 'common.save') }}
          </button>
        </div>
      </form>
    </section>
    <section class="panel">
      <div class="panel-title">
        <h2>{{ t('nav.theme') }}</h2>
      </div>
      <div class="panel-body stack">
        <label class="field"
          >{{ t('nav.theme')
          }}<select :value="theme.preference" @change="setTheme">
            <option value="light">{{ t('nav.light') }}</option>
            <option value="dark">{{ t('nav.dark') }}</option>
            <option value="system">{{ t('nav.system') }}</option>
          </select></label
        >
        <p class="field-hint">{{ t('profile.themeDescription') }}</p>
      </div>
    </section>
    <section class="panel">
      <div class="panel-title">
        <h2>{{ t('profile.security') }}</h2>
        <p>{{ t('profile.securityDescription') }}</p>
      </div>
      <form class="panel-body stack" @submit.prevent="changePassword">
        <label class="field"
          >{{ t('profile.currentPassword')
          }}<input
            v-model="password.current"
            type="password"
            autocomplete="current-password"
            maxlength="128"
            required
            :disabled="passwordBusy" /></label
        ><label class="field"
          >{{ t('profile.newPassword')
          }}<input
            v-model="password.next"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            required
            :disabled="passwordBusy"
          /><span class="field-hint">{{ t('auth.passwordHint') }}</span></label
        ><label class="field"
          >{{ t('profile.confirmPassword')
          }}<input
            v-model="password.confirm"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            required
            :disabled="passwordBusy"
        /></label>
        <p v-if="passwordValidation" class="field-error" role="alert">{{ passwordValidation }}</p>
        <ApiNotice :error="passwordError" />
        <div>
          <button class="button primary" :disabled="passwordBusy">
            {{ t(passwordBusy ? 'common.saving' : 'profile.security') }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
