<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from 'lucide-vue-next'
import { credits } from '../../api/credits'
import type { CreditPricing, CreditRule } from '../../api/credit-contracts'
import ApiNotice from '../../components/ApiNotice.vue'
const { t } = useI18n()
const data = ref<CreditPricing | null>(null),
  sizes = ref<{ size: string; multiplier: string }[]>([])
const loading = ref(false),
  busy = ref(false),
  notice = ref(''),
  validation = ref('')
const error = shallowRef<unknown>(null)
let controller: AbortController | null = null,
  generation = 0,
  alive = true
onMounted(() => void load())
onUnmounted(() => {
  alive = false
  generation++
  controller?.abort()
})
function apply(result: CreditPricing) {
  data.value = result
  sizes.value = Object.entries(result.configuration.size_multipliers).map(([size, multiplier]) => ({
    size,
    multiplier,
  }))
}
async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  try {
    const result = await credits.pricing(controller.signal)
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
function addRule() {
  data.value?.rules.push({
    model_id: '',
    operation: 'generate',
    quality: 'medium',
    credits_per_image: 7,
    enabled: true,
  })
}
function removeRule(index: number) {
  data.value?.rules.splice(index, 1)
}
function global(rule: CreditRule) {
  return rule.model_id === null
}
async function save() {
  if (busy.value || !data.value) return
  validation.value = ''
  notice.value = ''
  error.value = null
  const multipliers: Record<string, string> = {}
  for (const item of sizes.value) {
    const size = item.size.trim()
    if (!size || Object.hasOwn(multipliers, size)) {
      validation.value = t('credits.invalid')
      return
    }
    multipliers[size] = item.multiplier.trim()
  }
  const payload: CreditPricing = {
    rules: data.value.rules.map((rule) => ({
      ...rule,
      model_id: rule.model_id?.trim() || null,
      credits_per_image: Number(rule.credits_per_image),
    })),
    configuration: {
      ...data.value.configuration,
      signup_bonus_credits: Number(data.value.configuration.signup_bonus_credits),
      daily_free_credits: Number(data.value.configuration.daily_free_credits),
      credits_timezone: data.value.configuration.credits_timezone.trim(),
      edit_multiplier: data.value.configuration.edit_multiplier.trim(),
      size_multipliers: multipliers,
    },
  }
  if (
    payload.rules.some(
      (rule) =>
        !Number.isSafeInteger(rule.credits_per_image) ||
        rule.credits_per_image < 0 ||
        rule.credits_per_image > 1e9,
    ) ||
    !Number.isSafeInteger(payload.configuration.signup_bonus_credits) ||
    !Number.isSafeInteger(payload.configuration.daily_free_credits)
  ) {
    validation.value = t('credits.invalid')
    return
  }
  busy.value = true
  try {
    const result = await credits.savePricing(payload)
    if (alive) {
      apply(result)
      notice.value = t('credits.pricingSaved')
    }
  } catch (failure) {
    if (alive) error.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
</script>
<template>
  <div class="page-container">
    <div class="page-heading">
      <div>
        <h1>{{ t('credits.pricingTitle') }}</h1>
        <p>{{ t('credits.pricingDescription') }}</p>
      </div>
    </div>
    <ApiNotice :error="error" />
    <div v-if="loading" class="loading-state" role="status">{{ t('common.loading') }}</div>
    <button v-if="error && !data" class="button" @click="load">{{ t('common.retry') }}</button>
    <form v-if="data" class="stack" @submit.prevent="save">
      <section class="panel pricing-panel">
        <div class="panel-title">
          <h2>{{ t('credits.gifts') }}</h2>
          <p>{{ t('credits.giftHint') }}</p>
        </div>
        <div class="form-grid">
          <label class="field"
            >{{ t('credits.signupBonus')
            }}<input
              v-model.number="data.configuration.signup_bonus_credits"
              type="number"
              min="0"
              max="1000000000"
              step="1"
              required
              :disabled="busy"
          /></label>
          <label class="field"
            >{{ t('credits.dailyGrant')
            }}<input
              v-model.number="data.configuration.daily_free_credits"
              type="number"
              min="0"
              max="1000000000"
              step="1"
              required
              :disabled="busy"
          /></label>
          <label class="field"
            >{{ t('credits.creditsTimezone')
            }}<input
              v-model="data.configuration.credits_timezone"
              maxlength="100"
              required
              :disabled="busy"
          /></label>
          <label class="field"
            >{{ t('credits.editMultiplier')
            }}<input
              v-model="data.configuration.edit_multiplier"
              inputmode="decimal"
              maxlength="8"
              required
              :disabled="busy"
          /></label>
        </div>
      </section>
      <section class="panel data-panel">
        <div class="panel-title section-heading">
          <div>
            <h2>{{ t('credits.rules') }}</h2>
            <p>{{ t('credits.priceHint') }}</p>
          </div>
          <button
            class="button compact"
            type="button"
            :disabled="busy || data.rules.length >= 500"
            @click="addRule"
          >
            <Plus :size="15" />{{ t('credits.addRule') }}
          </button>
        </div>
        <div class="table-scroll">
          <table class="pricing-table">
            <thead>
              <tr>
                <th>{{ t('credits.model') }}</th>
                <th>{{ t('credits.operation') }}</th>
                <th>{{ t('credits.quality') }}</th>
                <th>{{ t('credits.unitPrice') }}</th>
                <th>{{ t('credits.enabled') }}</th>
                <th>{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(rule, index) in data.rules" :key="index">
                <td>
                  <span v-if="global(rule)" class="badge purple">{{ t('credits.global') }}</span
                  ><input
                    v-else
                    v-model="rule.model_id"
                    :aria-label="t('credits.model')"
                    maxlength="36"
                    :placeholder="t('credits.modelHint')"
                    required
                    :disabled="busy"
                  />
                </td>
                <td>
                  <span v-if="global(rule)">{{ t(`credits.${rule.operation}`) }}</span
                  ><select
                    v-else
                    v-model="rule.operation"
                    :aria-label="t('credits.operation')"
                    :disabled="busy"
                  >
                    <option value="generate">{{ t('credits.generate') }}</option>
                    <option value="edit">{{ t('credits.edit') }}</option>
                  </select>
                </td>
                <td>
                  <span v-if="global(rule)">{{ t(`credits.${rule.quality}`) }}</span
                  ><select
                    v-else
                    v-model="rule.quality"
                    :aria-label="t('credits.quality')"
                    :disabled="busy"
                  >
                    <option
                      v-for="quality in ['low', 'medium', 'high']"
                      :key="quality"
                      :value="quality"
                    >
                      {{ t(`credits.${quality}`) }}
                    </option>
                  </select>
                </td>
                <td>
                  <input
                    v-model.number="rule.credits_per_image"
                    type="number"
                    min="0"
                    max="1000000000"
                    step="1"
                    :aria-label="`${t('credits.unitPrice')} ${t(`credits.${rule.operation}`)} ${t(`credits.${rule.quality}`)}`"
                    required
                    :disabled="busy"
                  />
                </td>
                <td>
                  <input
                    v-model="rule.enabled"
                    type="checkbox"
                    :aria-label="`${t('credits.enabled')} ${t(`credits.${rule.operation}`)} ${t(`credits.${rule.quality}`)}`"
                    :disabled="busy"
                  />
                </td>
                <td>
                  <button
                    v-if="!global(rule)"
                    class="icon-button danger-text"
                    type="button"
                    :aria-label="t('credits.removeRule')"
                    :disabled="busy"
                    @click="removeRule(index)"
                  >
                    <Trash2 :size="16" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel pricing-panel">
        <div class="section-heading">
          <h2>{{ t('credits.sizeMultipliers') }}</h2>
          <button
            class="button compact"
            type="button"
            :disabled="busy || sizes.length >= 20"
            @click="sizes.push({ size: '', multiplier: '1.00' })"
          >
            <Plus :size="15" />{{ t('credits.addSize') }}
          </button>
        </div>
        <div v-for="(item, index) in sizes" :key="index" class="size-rule">
          <label class="field"
            >{{ t('credits.size')
            }}<input v-model="item.size" maxlength="12" required :disabled="busy" /></label
          ><label class="field"
            >{{ t('credits.multiplier')
            }}<input
              v-model="item.multiplier"
              inputmode="decimal"
              maxlength="8"
              required
              :disabled="busy" /></label
          ><button
            class="icon-button danger-text"
            type="button"
            :aria-label="t('credits.removeSize')"
            :disabled="busy"
            @click="sizes.splice(index, 1)"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </section>
      <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
      <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
      <div class="pricing-actions">
        <button class="button primary" :disabled="busy">
          {{ t(busy ? 'common.saving' : 'credits.savePricing') }}
        </button>
      </div>
    </form>
  </div>
</template>
