<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LockKeyhole, Save } from 'lucide-vue-next'
import { accounts } from '../../api/accounts'
import type {
  SettingsView,
  SettingsUpdate,
  SiteSettings,
  RegistrationSettings,
  MailSettings,
} from '../../api/contracts'
import { useSiteStore } from '../../stores/site'
import { useSystemStore } from '../../stores/system'
import ApiNotice from '../../components/ApiNotice.vue'
const route = useRoute()
const { t } = useI18n()
const publicSite = useSiteStore()
const system = useSystemStore()
const group = computed(() =>
  route.params.group === 'registration' || route.params.group === 'mail'
    ? route.params.group
    : 'site',
)
const data = shallowRef<SettingsView | null>(null)
const site = ref<SiteSettings | null>(null)
const registration = ref<RegistrationSettings | null>(null)
const mail = ref<MailSettings | null>(null)
const allow = ref('')
const block = ref('')
const mailPassword = ref('')
const clearPassword = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = shallowRef<unknown>(null)
const notice = ref('')
const validation = ref('')
let controller: AbortController | null = null
let generation = 0
const overridden = (key: string) => data.value?.env_overrides.includes(key) ?? false
watch(group, () => void load(), { immediate: true })
onUnmounted(() => controller?.abort())
onMounted(() => {
  void system.loadVersion()
})
function apply(result: SettingsView) {
  data.value = result
  site.value = { ...result.site }
  registration.value = { ...result.registration }
  mail.value = { ...result.mail }
  allow.value = result.registration.domain_allowlist.join('\n')
  block.value = result.registration.domain_blocklist.join('\n')
  mailPassword.value = ''
  clearPassword.value = false
}
async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  notice.value = ''
  validation.value = ''
  try {
    const result = await accounts.settings(group.value, controller.signal)
    if (current === generation) apply(result)
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
function domains(value: string) {
  return value
    .split(/[,\n]/)
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}
async function save() {
  if (!site.value || !registration.value || !mail.value) return
  error.value = null
  notice.value = ''
  validation.value = ''
  let update: SettingsUpdate
  if (group.value === 'site') update = { site: { ...site.value } }
  else if (group.value === 'registration')
    update = {
      registration: {
        ...registration.value,
        domain_allowlist: domains(allow.value),
        domain_blocklist: domains(block.value),
      },
    }
  else
    update = {
      mail: {
        host: mail.value.host.trim(),
        port: mail.value.port,
        username: mail.value.username,
        from: mail.value.from.trim(),
        encryption: mail.value.encryption,
        ...(clearPassword.value
          ? { password: '' }
          : mailPassword.value
            ? { password: mailPassword.value }
            : {}),
      },
    }
  busy.value = true
  try {
    apply(await accounts.saveSettings(group.value, update))
    notice.value = t('common.saved')
    await publicSite.load()
  } catch (failure) {
    error.value = failure
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-container settings-page">
    <div class="page-heading">
      <div>
        <h1>{{ t('settings.title') }}</h1>
        <p>{{ t('settings.description') }}</p>
      </div>
    </div>
    <nav class="section-tabs" :aria-label="t('settings.title')">
      <RouterLink
        v-for="tab in ['site', 'registration', 'mail']"
        :key="tab"
        :to="`/admin/settings/${tab}`"
        :class="{ active: group === tab }"
        :aria-current="group === tab ? 'page' : undefined"
        >{{ t(`settings.${tab}`) }}</RouterLink
      >
    </nav>
    <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
    <template v-else>
      <div v-if="data?.env_overrides.length" class="info-box">
        <LockKeyhole :size="17" />{{ t('settings.overridden') }}
      </div>
      <ApiNotice :error="error" /><button v-if="!data && error" class="button" @click="load">
        {{ t('common.retry') }}
      </button>
      <form v-if="data && site && registration && mail" class="panel" @submit.prevent="save">
        <div class="panel-title">
          <h2>{{ t(`settings.${group}`) }}</h2>
        </div>
        <div class="panel-body stack">
          <template v-if="group === 'site'"
            ><label class="field"
              >{{ t('settings.name')
              }}<span v-if="overridden('site.name')" class="env-badge">{{
                t('settings.envField')
              }}</span
              ><input
                v-model="site.name"
                name="site_name"
                maxlength="40"
                required
                :disabled="busy || overridden('site.name')" /></label
            ><label class="field"
              >{{ t('settings.siteDescription')
              }}<input
                v-model="site.description"
                name="site_description"
                maxlength="200"
                :disabled="busy" /></label
            ><label class="field"
              >{{ t('settings.footer')
              }}<input
                v-model="site.footer"
                name="site_footer"
                maxlength="200"
                :disabled="busy" /></label
            ><label class="field"
              >{{ t('settings.contact')
              }}<input
                v-model="site.contact"
                name="contact"
                maxlength="200"
                :disabled="busy" /></label
            ><label class="field"
              >{{ t('settings.termsUrl')
              }}<input
                v-model="site.terms_url"
                name="terms_url"
                maxlength="2048"
                required
                :disabled="busy" /></label
            ><label class="field"
              >{{ t('settings.privacyUrl')
              }}<input
                v-model="site.privacy_url"
                name="privacy_url"
                maxlength="2048"
                required
                :disabled="busy"
            /></label>
            <p class="field-hint">{{ t('settings.linksHint') }}</p></template
          >
          <template v-else-if="group === 'registration'"
            ><label class="switch-row"
              ><span
                ><strong>{{ t('settings.registrationEnabled') }}</strong
                ><span v-if="overridden('registration.enabled')" class="env-badge">{{
                  t('settings.envField')
                }}</span></span
              ><input
                v-model="registration.enabled"
                type="checkbox"
                name="registration_enabled"
                role="switch"
                :disabled="busy || overridden('registration.enabled')" /></label
            ><label class="switch-row"
              ><span
                ><strong>{{ t('settings.emailVerification') }}</strong
                ><small>{{ t('settings.emailVerificationHint') }}</small
                ><span
                  v-if="overridden('registration.email_verification_enabled')"
                  class="env-badge"
                  >{{ t('settings.envField') }}</span
                ></span
              ><input
                v-model="registration.email_verification_enabled"
                type="checkbox"
                name="email_verification_enabled"
                role="switch"
                :disabled="busy || overridden('registration.email_verification_enabled')"
            /></label>
            <div class="form-grid">
              <label class="field"
                >{{ t('settings.allowlist')
                }}<textarea
                  v-model="allow"
                  rows="4"
                  name="domain_allowlist"
                  :disabled="busy || overridden('registration.domain_allowlist')"
                /></label
              ><label class="field"
                >{{ t('settings.blocklist')
                }}<textarea
                  v-model="block"
                  rows="4"
                  name="domain_blocklist"
                  :disabled="busy || overridden('registration.domain_blocklist')"
                />
              </label>
            </div>
            <p class="field-hint">{{ t('settings.domainsHint') }}</p>
            <div class="form-grid">
              <label class="field"
                >{{ t('settings.loginFailures')
                }}<input
                  v-model.number="registration.login_failure_limit"
                  type="number"
                  min="3"
                  max="20"
                  required
                  :disabled="busy" /></label
              ><label class="field"
                >{{ t('settings.lockMinutes')
                }}<input
                  v-model.number="registration.login_lock_minutes"
                  type="number"
                  min="1"
                  max="120"
                  required
                  :disabled="busy" /></label
              ><label class="field"
                >{{ t('settings.loginRate')
                }}<input
                  v-model.number="registration.login_per_minute"
                  type="number"
                  min="1"
                  max="120"
                  required
                  :disabled="busy" /></label
              ><label class="field"
                >{{ t('settings.registerRate')
                }}<input
                  v-model.number="registration.register_per_minute"
                  type="number"
                  min="1"
                  max="60"
                  required
                  :disabled="busy" /></label
              ><label class="field"
                >{{ t('settings.codeRate')
                }}<input
                  v-model.number="registration.code_per_minute"
                  type="number"
                  min="1"
                  max="20"
                  required
                  :disabled="busy"
              /></label></div
          ></template>
          <template v-else
            ><p class="field-hint">{{ t('settings.mailHint') }}</p>
            <div class="form-grid">
              <label class="field"
                >{{ t('settings.mailHost')
                }}<input
                  v-model="mail.host"
                  name="smtp_host"
                  maxlength="253"
                  :disabled="busy || overridden('mail.host')" /></label
              ><label class="field"
                >{{ t('settings.mailPort')
                }}<input
                  v-model.number="mail.port"
                  name="smtp_port"
                  type="number"
                  min="1"
                  max="65535"
                  required
                  :disabled="busy || overridden('mail.port')"
              /></label>
            </div>
            <label class="field"
              >{{ t('settings.mailEncryption')
              }}<select
                v-model="mail.encryption"
                name="smtp_encryption"
                :disabled="busy || overridden('mail.encryption')"
              >
                <option value="starttls">{{ t('settings.starttls') }}</option>
                <option value="tls">{{ t('settings.tls') }}</option>
                <option value="none">{{ t('settings.noTLS') }}</option>
              </select></label
            ><label class="field"
              >{{ t('settings.mailFrom')
              }}<input
                v-model="mail.from"
                name="smtp_from"
                type="email"
                maxlength="254"
                :disabled="busy || overridden('mail.from')" /></label
            ><label class="field"
              >{{ t('settings.mailUser')
              }}<input
                v-model="mail.username"
                name="smtp_username"
                maxlength="254"
                autocomplete="off"
                :disabled="busy || overridden('mail.username')" /></label
            ><label class="field"
              >{{ t('settings.mailPassword')
              }}<input
                v-model="mailPassword"
                name="smtp_password"
                type="password"
                autocomplete="new-password"
                maxlength="4096"
                :placeholder="
                  t(
                    mail.password_configured
                      ? 'settings.mailSecretSaved'
                      : 'settings.mailSecretEmpty',
                  )
                "
                :disabled="busy || clearPassword || overridden('mail.password')" /></label
            ><label
              v-if="mail.password_configured && !overridden('mail.password')"
              class="checkbox-field"
              ><input v-model="clearPassword" type="checkbox" :disabled="busy" />{{
                t('settings.mailClear')
              }}</label
            >
            <p class="field-hint">{{ t('settings.passwordNeverReturned') }}</p></template
          >
          <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
          <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
          <div class="settings-save">
            <button class="button primary" :disabled="busy">
              <Save :size="16" />{{ t(busy ? 'common.saving' : 'common.save') }}
            </button>
          </div>
        </div>
      </form>
      <p v-if="system.version" class="build-caption">
        {{ t('admin.version') }}
        {{ system.version.version === 'dev' ? t('welcome.development') : system.version.version }}
      </p>
    </template>
  </div>
</template>
