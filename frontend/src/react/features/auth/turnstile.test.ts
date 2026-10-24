import { afterEach, expect, it, vi } from 'vitest'
import { createChallenge } from './turnstile'

interface Options {
  action: string
  size: string
  callback(token: string): void
  'error-callback'(): void
}
afterEach(() => {
  vi.useRealTimers()
})

it('requests separate action tokens and removes widgets on disposal', async () => {
  const options: Options[] = []
  const remove = vi.fn()
  vi.stubGlobal('turnstile', {
    render: (_element: HTMLElement, value: Options) => {
      options.push(value)
      return String(options.length)
    },
    execute: () => options.at(-1)?.callback('provider-token'),
    remove,
  })
  const widget = createChallenge(
    () => document.createElement('div'),
    () => 'public-site-key',
  )
  await expect(widget.token('send_code')).resolves.toBe('provider-token')
  await expect(widget.token('register')).resolves.toBe('provider-token')
  expect(options.map((value) => value.action)).toEqual(['send_code', 'register'])
  expect(options.every((value) => value.size === 'compact')).toBe(true)
  widget.dispose()
  expect(remove.mock.calls.map((args: unknown[]) => args[0])).toEqual(['1', '2'])
  await expect(widget.token('register')).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' })
})

it('rejects an unfinished challenge on unmount without leaving a timer', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('turnstile', { render: () => 'pending-widget', execute: vi.fn(), remove: vi.fn() })
  const widget = createChallenge(
    () => document.createElement('div'),
    () => 'public-site-key',
  )
  const token = widget.token('register')
  const rejection = expect(token).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' })
  await Promise.resolve()
  widget.dispose()
  await rejection
  expect(vi.getTimerCount()).toBe(0)
})

it('reports provider setup failures and clears challenge deadlines', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('turnstile', {
    render: () => {
      throw new Error('Unavailable')
    },
    execute: vi.fn(),
    remove: vi.fn(),
  })
  const widget = createChallenge(
    () => document.createElement('div'),
    () => 'public-site-key',
  )
  await expect(widget.token('register')).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' })
  expect(vi.getTimerCount()).toBe(0)
})
