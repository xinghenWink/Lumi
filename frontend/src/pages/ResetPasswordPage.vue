<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { operations } from '../api/operations'
import { validPassword } from '../features/accounts/utils'
import ApiNotice from '../components/ApiNotice.vue'
import BrandMark from '../components/BrandMark.vue'
const route = useRoute(),
  { t, locale } = useI18n()
const resetting = computed(() => route.name === 'reset-password'),
  token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
if (resetting.value) window.history.replaceState(null, '', window.location.pathname)
const email = ref(''),
  password = ref(''),
  busy = ref(false),
  done = ref(false),
  error = shallowRef<unknown>(),
  invalid = ref('')
async function submit() {
  busy.value = true
  error.value = undefined
  invalid.value = ''
  try {
    if (resetting.value) {
      if (!validPassword(password.value)) {
        invalid.value = t('auth.passwordInvalid')
        return
      }
      await operations.reset(token, password.value)
      password.value = ''
    } else await operations.forgot(email.value, locale.value === 'en' ? 'en' : 'zh-CN')
    done.value = true
  } catch (e) {
    error.value = e
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <main class="page-container ops-page">
    <section class="panel ops-section ops-form">
      <BrandMark />
      <h1>{{ t(resetting ? 'ops.resetTitle' : 'ops.forgotTitle') }}</h1>
      <ApiNotice :error="error" />
      <p v-if="done" role="status">{{ t(resetting ? 'ops.resetDone' : 'ops.resetSent') }}</p>
      <form v-else class="ops-form" @submit.prevent="submit">
        <label v-if="!resetting"
          >{{ t('auth.email')
          }}<input
            v-model="email"
            type="email"
            autocomplete="email"
            maxlength="254"
            required /></label
        ><label v-else
          >{{ t('ops.newPassword')
          }}<input
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
        /></label>
        <p v-if="invalid" role="alert">{{ invalid }}</p>
        <button class="button primary" :disabled="busy">
          {{ t(resetting ? 'ops.resetPassword' : 'ops.sendReset') }}
        </button>
      </form>
      <RouterLink class="text-button" to="/login">{{ t('ops.backLogin') }}</RouterLink>
    </section>
  </main>
</template>
