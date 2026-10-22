<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock3, Gift, Wallet, Plus } from 'lucide-vue-next'
import { credits } from '../../api/credits'
import type { CreditAdjustInput } from '../../api/credit-contracts'
import { useCursorPage, useMutationKey } from '../../features/credits/resources'
import { useTime } from '../../features/accounts/time'
import ApiNotice from '../ApiNotice.vue'
import ModalDialog from '../ModalDialog.vue'
const props = defineProps<{ userId?: string }>()
const emit = defineEmits<{ changed: [] }>()
const { t, locale } = useI18n(),
  formatTime = useTime()
const { data, loading, error, reset, load } = useCursorPage(async (_, signal) => ({
  next_cursor: '',
  account: await credits.account(props.userId, signal),
}))
const account = computed(() => data.value?.account ?? null)
const number = (value: number) => new Intl.NumberFormat(locale.value).format(value)
const code = ref(''),
  notice = ref(''),
  busy = ref(false),
  open = ref(false),
  validation = ref('')
const actionError = shallowRef<unknown>(null)
const form = reactive({
  bucket: 'permanent' as 'permanent' | 'daily',
  action: 'add' as CreditAdjustInput['action'],
  amount: '0',
  note: '',
})
const key = useMutationKey()
let alive = true
onUnmounted(() => {
  alive = false
})
watch(
  () => props.userId,
  () => {
    key.complete()
    data.value = null
    open.value = false
    notice.value = ''
    void reset()
  },
)
async function redeem() {
  if (busy.value || !code.value.trim()) return
  busy.value = true
  actionError.value = null
  notice.value = ''
  const value = code.value.trim()
  try {
    const result = await credits.redeem(value, key.forPayload(value))
    key.complete()
    if (!alive) return
    data.value = { next_cursor: '', account: result.account }
    code.value = ''
    notice.value = t('credits.redeemSuccess', { amount: number(result.credits) })
    emit('changed')
  } catch (failure) {
    if (alive) actionError.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
function openAdjustment() {
  open.value = true
  actionError.value = null
  validation.value = ''
  notice.value = ''
}
async function adjust() {
  if (busy.value || !props.userId) return
  validation.value = ''
  actionError.value = null
  const amount = Number(form.amount)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12 || !form.note.trim()) {
    validation.value = t('credits.invalid')
    return
  }
  const body: CreditAdjustInput = {
    bucket: form.bucket,
    action: form.action,
    amount,
    note: form.note.trim(),
  }
  busy.value = true
  try {
    const result = await credits.adjust(props.userId, body, key.forPayload(body))
    key.complete()
    if (!alive) return
    data.value = { next_cursor: '', account: result }
    open.value = false
    form.note = ''
    form.amount = '0'
    notice.value = t('credits.adjusted')
    emit('changed')
  } catch (failure) {
    if (alive) actionError.value = failure
  } finally {
    if (alive) busy.value = false
  }
}
</script>
<template>
  <section class="panel credit-overview" :aria-busy="loading">
    <div v-if="loading" class="loading-state" role="status">{{ t('credits.loading') }}</div>
    <ApiNotice :error="error" />
    <button v-if="error" class="button" @click="load">{{ t('common.retry') }}</button>
    <template v-if="account">
      <div class="credit-heading">
        <div>
          <span class="eyebrow">{{ t('credits.total') }}</span>
          <div class="credit-total">
            <strong
              data-testid="credit-total"
              :class="{ 'long-balance': number(account.total).length > 11 }"
              >{{ number(account.total) }}</strong
            ><span>{{ t('credits.unit') }}</span>
          </div>
        </div>
        <button v-if="userId" class="button primary" @click="openAdjustment">
          <Plus :size="16" />{{ t('credits.adjust') }}
        </button>
        <Wallet v-else class="credit-watermark" :size="34" aria-hidden="true" />
      </div>
      <div class="credit-buckets">
        <div>
          <span class="credit-bucket-label"><Gift :size="16" />{{ t('credits.daily') }}</span
          ><strong data-testid="daily-balance">{{ number(account.daily_balance) }}</strong
          ><span>{{ t('credits.dailyHint') }}</span>
        </div>
        <div>
          <span class="credit-bucket-label"><Wallet :size="16" />{{ t('credits.permanent') }}</span
          ><strong data-testid="permanent-balance">{{ number(account.permanent_balance) }}</strong
          ><span>{{ t('credits.permanentHint') }}</span>
        </div>
      </div>
      <div class="credit-rail" aria-hidden="true">
        <span
          :style="{
            width: `${account.total ? (account.daily_balance / account.total) * 100 : 0}%`,
          }"
        />
      </div>
      <p class="credit-reset">
        <Clock3 :size="14" />{{ t('credits.resetAt', { time: formatTime(account.next_reset_at) })
        }}<span>{{ t('credits.timezone', { zone: account.timezone }) }}</span>
      </p>
    </template>
    <form v-if="!userId" class="redeem-form" @submit.prevent="redeem">
      <label class="field" for="redeem-code">{{ t('credits.redeem') }}</label>
      <div>
        <input
          id="redeem-code"
          v-model="code"
          name="redeem-code"
          maxlength="80"
          autocomplete="off"
          autocapitalize="characters"
          :placeholder="t('credits.codePlaceholder')"
          :disabled="busy"
          required
        /><button class="button primary" :disabled="busy || !code.trim()">
          {{ t(busy ? 'common.saving' : 'credits.redeemAction') }}
        </button>
      </div>
      <p class="field-hint">{{ t('credits.redeemHint') }}</p>
    </form>
    <ApiNotice v-if="!open" :error="actionError" />
    <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
  </section>
  <ModalDialog
    v-model:open="open"
    :busy="busy"
    :title="t('credits.adjust')"
    :description="t('credits.adjustDescription')"
  >
    <form class="stack" @submit.prevent="adjust">
      <div class="form-grid">
        <label class="field"
          >{{ t('credits.bucket')
          }}<select v-model="form.bucket" :disabled="busy">
            <option value="permanent">{{ t('credits.permanent') }}</option>
            <option value="daily">{{ t('credits.daily') }}</option>
          </select></label
        >
        <label class="field"
          >{{ t('credits.action')
          }}<select v-model="form.action" :disabled="busy">
            <option v-for="action in ['add', 'subtract', 'set']" :key="action" :value="action">
              {{ t(`credits.${action}`) }}
            </option>
          </select></label
        >
      </div>
      <label class="field"
        >{{ t('credits.amount')
        }}<input
          v-model="form.amount"
          type="number"
          min="0"
          max="1000000000000"
          step="1"
          required
          :disabled="busy"
      /></label>
      <label class="field"
        >{{ t('credits.note')
        }}<textarea
          v-model="form.note"
          maxlength="200"
          rows="3"
          :placeholder="t('credits.notePlaceholder')"
          required
          :disabled="busy"
        />
      </label>
      <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
      <ApiNotice :error="actionError" />
      <div class="dialog-actions">
        <button class="button" type="button" :disabled="busy" @click="open = false">
          {{ t('common.cancel') }}</button
        ><button class="button primary" :disabled="busy">
          {{ t(busy ? 'common.saving' : 'credits.adjustAction') }}
        </button>
      </div>
    </form>
  </ModalDialog>
</template>
