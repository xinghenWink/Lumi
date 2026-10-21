<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, Eye, EyeOff, MessageSquare, Sparkles } from 'lucide-vue-next'
import BrandMark from '../components/BrandMark.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import ApiNotice from '../components/ApiNotice.vue'
import { useAuthStore } from '../stores/auth'
import { useSiteStore } from '../stores/site'
import { safeRedirect, validEmail, validPassword } from '../features/accounts/utils'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const site = useSiteStore()
const registering = computed(() => route.name === 'register')
const email = ref('')
const password = ref('')
const nickname = ref('')
const code = ref('')
const acceptTerms = ref(false)
const visible = ref(false)
const pending = ref(false)
const sending = ref(false)
const seconds = ref(0)
const error = shallowRef<unknown>(null)
const validation = ref('')
const notice = ref('')
let interval: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void site.load()
  interval = setInterval(() => {
    if (seconds.value > 0) seconds.value--
  }, 1000)
})
onUnmounted(() => {
  if (interval) clearInterval(interval)
  password.value = ''
})
watch(registering, () => {
  error.value = null
  validation.value = ''
  notice.value = ''
  password.value = ''
  code.value = ''
})

async function sendCode() {
  error.value = null
  validation.value = ''
  notice.value = ''
  if (!validEmail(email.value.trim())) {
    validation.value = t('auth.emailInvalid')
    return
  }
  sending.value = true
  try {
    seconds.value = await auth.sendCode(email.value.trim(), locale.value === 'en' ? 'en' : 'zh-CN')
    notice.value = t('auth.codeSent')
  } catch (failure) {
    error.value = failure
  } finally {
    sending.value = false
  }
}
async function submit() {
  error.value = null
  validation.value = ''
  notice.value = ''
  if (!validEmail(email.value.trim())) {
    validation.value = t('auth.emailInvalid')
    return
  }
  if (registering.value) {
    if (!validPassword(password.value)) {
      validation.value = t('auth.passwordInvalid')
      return
    }
    if (!nickname.value.trim() || Array.from(nickname.value.trim()).length > 30) {
      validation.value = t('auth.nicknameInvalid')
      return
    }
    if (site.config?.email_verification_enabled && !/^\d{6}$/.test(code.value)) {
      validation.value = t('auth.codeInvalid')
      return
    }
    if (!acceptTerms.value) {
      validation.value = t('auth.termsRequired')
      return
    }
  } else if (!password.value) {
    validation.value = t('common.required')
    return
  }
  pending.value = true
  try {
    if (registering.value)
      await auth.register({
        email: email.value.trim(),
        password: password.value,
        nickname: nickname.value.trim(),
        code: code.value,
        accept_terms: true,
      })
    else await auth.login({ email: email.value.trim(), password: password.value })
    password.value = ''
    await router.replace(safeRedirect(route.query.redirect))
  } catch (failure) {
    error.value = failure
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="auth-layout">
    <a class="skip-link" href="#auth-main">{{ t('app.skipLink') }}</a>
    <aside class="auth-story">
      <div class="brand-lockup">
        <BrandMark /><span class="brand-name">{{ site.config?.site.name ?? t('app.name') }}</span>
      </div>
      <div class="auth-story-content">
        <div class="story-symbol" aria-hidden="true">
          <Sparkles :size="62" :stroke-width="1.2" />
        </div>
        <h1>{{ t('auth.heroTitle') }}</h1>
        <p>{{ t('auth.heroDescription') }}</p>
        <div class="story-feature">
          <MessageSquare :size="20" />
          <div>
            <strong>{{ t('auth.heroChat') }}</strong
            ><span>{{ t('auth.heroChatDescription') }}</span>
          </div>
        </div>
        <div class="story-feature">
          <Sparkles :size="20" />
          <div>
            <strong>{{ t('auth.heroImage') }}</strong
            ><span>{{ t('auth.heroImageDescription') }}</span>
          </div>
        </div>
      </div>
      <span class="story-footer">{{ site.config?.site.footer ?? t('auth.setupNote') }}</span>
    </aside>
    <main id="auth-main" class="auth-main">
      <div class="auth-tools"><ThemeToggle /></div>
      <div class="auth-form-wrap">
        <div class="auth-mobile-brand brand-lockup">
          <BrandMark /><span class="brand-name">{{ site.config?.site.name ?? t('app.name') }}</span>
        </div>
        <h2>{{ t(registering ? 'auth.registerTitle' : 'auth.loginTitle') }}</h2>
        <p class="page-description">
          {{ t(registering ? 'auth.registerDescription' : 'auth.loginDescription') }}
        </p>
        <nav class="auth-tabs" :aria-label="t('auth.setupNote')">
          <RouterLink to="/login" :aria-current="!registering ? 'page' : undefined">{{
            t('auth.login')
          }}</RouterLink
          ><RouterLink to="/register" :aria-current="registering ? 'page' : undefined">{{
            t('auth.register')
          }}</RouterLink>
        </nav>
        <div v-if="site.loading && !site.config" class="loading-state" role="status">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="site.error" class="stack">
          <ApiNotice :error="site.error" /><button class="button" @click="site.load">
            {{ t('common.retry') }}
          </button>
        </div>
        <div
          v-else-if="registering && site.config && !site.config.registration_enabled"
          class="info-box"
          role="status"
        >
          {{ t('auth.registrationClosed') }}
        </div>
        <form v-else class="stack auth-form" novalidate @submit.prevent="submit">
          <label v-if="registering" class="field" for="auth-nickname"
            >{{ t('auth.nickname')
            }}<input
              id="auth-nickname"
              v-model="nickname"
              name="nickname"
              autocomplete="nickname"
              maxlength="30"
              :placeholder="t('auth.nicknamePlaceholder')"
              :disabled="pending"
          /></label>
          <label class="field" for="auth-email"
            >{{ t('auth.email')
            }}<input
              id="auth-email"
              v-model="email"
              name="email"
              type="email"
              autocomplete="email"
              maxlength="254"
              :placeholder="t('auth.emailPlaceholder')"
              :disabled="pending"
          /></label>
          <label class="field" for="auth-password"
            >{{ t('auth.password')
            }}<span class="password-field"
              ><input
                id="auth-password"
                v-model="password"
                name="password"
                :type="visible ? 'text' : 'password'"
                :autocomplete="registering ? 'new-password' : 'current-password'"
                maxlength="128"
                :placeholder="t('auth.passwordHint')"
                :disabled="pending" /><button
                type="button"
                class="icon-button"
                :aria-label="t(visible ? 'auth.hidePassword' : 'auth.showPassword')"
                @click="visible = !visible"
              >
                <EyeOff v-if="visible" :size="17" /><Eye v-else :size="17" /></button></span
          ></label>
          <label
            v-if="registering && site.config?.email_verification_enabled"
            class="field"
            for="auth-code"
            >{{ t('auth.code')
            }}<span class="code-field"
              ><input
                id="auth-code"
                v-model="code"
                name="code"
                autocomplete="one-time-code"
                inputmode="numeric"
                maxlength="6"
                :placeholder="t('auth.codePlaceholder')"
                :disabled="pending"
              /><button
                class="button"
                type="button"
                :disabled="sending || pending || seconds > 0"
                @click="sendCode"
              >
                {{
                  sending
                    ? t('auth.sendingCode')
                    : seconds
                      ? t('auth.resend', { seconds })
                      : t('auth.sendCode')
                }}
              </button></span
            ></label
          >
          <label v-if="registering" class="checkbox-field"
            ><input
              v-model="acceptTerms"
              type="checkbox"
              name="accept_terms"
              :disabled="pending"
            /><span
              >{{ t('auth.agree') }}
              <a
                :href="site.config?.site.terms_url ?? '/terms'"
                target="_blank"
                rel="noopener noreferrer"
                >{{ t('auth.terms') }}</a
              >
              {{ t('auth.and') }}
              <a
                :href="site.config?.site.privacy_url ?? '/privacy'"
                target="_blank"
                rel="noopener noreferrer"
                >{{ t('auth.privacy') }}</a
              ></span
            ></label
          >
          <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
          <ApiNotice :error="error" />
          <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
          <button
            type="submit"
            class="button primary auth-submit"
            :disabled="pending || !site.config"
          >
            {{ pending ? t('auth.submitting') : t(registering ? 'auth.create' : 'auth.enter')
            }}<ArrowUpRight v-if="!pending" :size="17" />
          </button>
        </form>
        <div class="auth-legal">
          <RouterLink to="/terms">{{ t('auth.terms') }}</RouterLink
          ><span aria-hidden="true">·</span
          ><RouterLink to="/privacy">{{ t('auth.privacy') }}</RouterLink>
        </div>
      </div>
    </main>
  </div>
</template>
