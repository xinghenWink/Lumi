<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, RefreshCw, Sprout } from 'lucide-vue-next'
import { useSystemStore } from '../stores/system'
import BrandMark from '../components/BrandMark.vue'

const { t, locale } = useI18n()
const system = useSystemStore()
onMounted(() => void system.loadVersion())

function displayBuildTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? t('welcome.unknown')
    : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
        date,
      )
}
</script>

<template>
  <div class="welcome-layout">
    <a class="skip-link" href="#main">{{ t('app.skipLink') }}</a>
    <header class="site-header">
      <div class="brand-lockup">
        <BrandMark />
        <span class="brand-name">{{ t('app.name') }}</span>
        <span class="brand-divider" aria-hidden="true" />
        <span class="brand-tagline">{{ t('app.tagline') }}</span>
      </div>
      <span class="milestone-label">{{ t('welcome.milestone') }}</span>
    </header>

    <main id="main" class="welcome-main">
      <div class="intro">
        <span class="intro-badge"><span aria-hidden="true" />{{ t('welcome.badge') }}</span>
        <h1>{{ t('welcome.title') }}</h1>
        <p>{{ t('welcome.description') }}</p>
      </div>

      <section class="foundation-panel" aria-labelledby="foundation-title">
        <div class="panel-heading">
          <div class="sprout-mark">
            <Sprout :size="22" :stroke-width="1.6" aria-hidden="true" />
          </div>
          <div>
            <h2 id="foundation-title">{{ t('welcome.preparing') }}</h2>
            <p>{{ t('welcome.scope') }}</p>
          </div>
        </div>
        <div class="version-area" aria-live="polite" :aria-busy="system.status === 'loading'">
          <p v-if="system.status === 'loading' || system.status === 'idle'" class="status-message">
            {{ t('welcome.loading') }}
          </p>
          <p v-else-if="system.status === 'error'" class="status-message error-message">
            {{ t('welcome.unavailable') }}
          </p>
          <dl v-else-if="system.version" class="version-details">
            <div>
              <dt>{{ t('welcome.version') }}</dt>
              <dd>
                {{
                  system.version.version === 'dev'
                    ? t('welcome.development')
                    : system.version.version
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t('welcome.commit') }}</dt>
              <dd>
                {{
                  system.version.commit === 'unknown'
                    ? t('welcome.unknown')
                    : system.version.commit.slice(0, 12)
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t('welcome.buildTime') }}</dt>
              <dd>{{ displayBuildTime(system.version.build_time) }}</dd>
            </div>
          </dl>
          <button
            class="refresh-button"
            :disabled="system.status === 'loading'"
            @click="system.loadVersion"
          >
            <RefreshCw :size="15" aria-hidden="true" />
            {{ t(system.status === 'error' ? 'welcome.retry' : 'welcome.refresh') }}
            <ArrowUpRight :size="15" aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
    <footer class="site-footer"><span aria-hidden="true">✦</span>{{ t('welcome.footer') }}</footer>
  </div>
</template>
