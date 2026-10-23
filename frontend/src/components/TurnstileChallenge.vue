<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { ApiError } from '../api/transport'
interface TurnstileAPI {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      execution: 'execute'
      callback: (token: string) => void
      'error-callback': () => void
      'expired-callback': () => void
    },
  ): string
  execute(id: string): void
  remove(id: string): void
}
declare global {
  interface Window {
    turnstile?: TurnstileAPI
  }
}
const props = defineProps<{ siteKey: string }>(),
  container = ref<HTMLDivElement>()
let widget = '',
  alive = true,
  rejectPending: ((e: Error) => void) | undefined
onUnmounted(() => {
  alive = false
  if (widget) window.turnstile?.remove(widget)
  rejectPending?.(new ApiError('CHALLENGE_UNAVAILABLE'))
})
async function load() {
  if (window.turnstile) return window.turnstile
  await new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[data-lumi-turnstile]')
    if (!script) {
      script = document.createElement('script')
      script.dataset.lumiTurnstile = '1'
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      document.head.append(script)
    }
    const timeout = setTimeout(() => reject(new ApiError('CHALLENGE_UNAVAILABLE')), 15000)
    script.addEventListener(
      'load',
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
    script.addEventListener(
      'error',
      () => {
        clearTimeout(timeout)
        script?.remove()
        reject(new ApiError('CHALLENGE_UNAVAILABLE'))
      },
      { once: true },
    )
  })
  if (!window.turnstile) throw new ApiError('CHALLENGE_UNAVAILABLE')
  return window.turnstile
}
async function token(action: 'register' | 'send_code'): Promise<string> {
  const api = await load()
  if (!alive || !container.value) throw new ApiError('CHALLENGE_UNAVAILABLE')
  if (widget) api.remove(widget)
  const element = container.value
  return new Promise<string>((resolve, reject) => {
    rejectPending = reject
    const timeout = setTimeout(() => reject(new ApiError('CHALLENGE_REQUIRED')), 120000)
    const finish = (value?: string) => {
      clearTimeout(timeout)
      rejectPending = undefined
      if (value) resolve(value)
      else reject(new ApiError('CHALLENGE_INVALID'))
    }
    widget = api.render(element, {
      sitekey: props.siteKey,
      action,
      execution: 'execute',
      callback: finish,
      'error-callback': () => finish(),
      'expired-callback': () => finish(),
    })
    api.execute(widget)
  })
}
defineExpose({ token })
</script>
<template><div ref="container" class="turnstile-challenge" /></template>
