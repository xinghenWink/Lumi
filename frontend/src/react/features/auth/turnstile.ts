import { ApiError } from '../../../api/transport'

interface ChallengeAPI {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      execution: 'execute'
      size: 'compact'
      callback(token: string): void
      'error-callback'(): void
      'expired-callback'(): void
    },
  ): string
  execute(id: string): void
  remove(id: string): void
}
const sdk = () => (window as Window & { turnstile?: ChallengeAPI }).turnstile

function createLoader() {
  let pending: Promise<ChallengeAPI> | null = null
  return () => {
    const current = sdk()
    if (current) return Promise.resolve(current)
    if (pending) return pending
    pending = new Promise<ChallengeAPI>((resolve, reject) => {
      let script = document.querySelector<HTMLScriptElement>('script[data-lumi-turnstile]')
      if (!script) {
        script = document.createElement('script')
        script.dataset.lumiTurnstile = '1'
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        document.head.append(script)
      }
      const fail = () => {
        script?.remove()
        reject(new ApiError('CHALLENGE_UNAVAILABLE'))
      }
      const timer = setTimeout(fail, 15_000)
      script.addEventListener(
        'load',
        () => {
          clearTimeout(timer)
          const value = sdk()
          if (value) resolve(value)
          else fail()
        },
        { once: true },
      )
      script.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          fail()
        },
        { once: true },
      )
    }).finally(() => {
      pending = null
    })
    return pending
  }
}
const load = createLoader()

export function createChallenge(getContainer: () => HTMLElement | null, getSiteKey: () => string) {
  let widget = ''
  let disposed = false
  let rejectPending: ((error: Error) => void) | undefined
  return {
    async token(action: 'register' | 'send_code'): Promise<string> {
      const api = await load()
      const container = getContainer()
      if (disposed || !container) throw new ApiError('CHALLENGE_UNAVAILABLE')
      if (widget) api.remove(widget)
      rejectPending?.(new ApiError('CHALLENGE_UNAVAILABLE'))
      return new Promise<string>((resolve, reject) => {
        const finish = (token?: string) => {
          clearTimeout(timer)
          rejectPending = undefined
          if (token) resolve(token)
          else reject(new ApiError('CHALLENGE_INVALID'))
        }
        const timer = setTimeout(() => {
          rejectPending = undefined
          reject(new ApiError('CHALLENGE_REQUIRED'))
        }, 120_000)
        rejectPending = (error) => {
          clearTimeout(timer)
          reject(error)
        }
        try {
          widget = api.render(container, {
            sitekey: getSiteKey(),
            action,
            execution: 'execute',
            size: 'compact',
            callback: finish,
            'error-callback': () => finish(),
            'expired-callback': () => finish(),
          })
          api.execute(widget)
        } catch {
          clearTimeout(timer)
          rejectPending = undefined
          reject(new ApiError('CHALLENGE_UNAVAILABLE'))
        }
      })
    },
    dispose() {
      disposed = true
      if (widget) sdk()?.remove(widget)
      rejectPending?.(new ApiError('CHALLENGE_UNAVAILABLE'))
    },
  }
}
