import { describe, expect, it } from 'vitest'
import { createMutationKey } from './resources'
describe('business mutation identity', () => {
  it('keeps an uncertain payload key until confirmation or a different explicit action', () => {
    const key = createMutationKey(),
      first = key.forPayload({ code: 'one' })
    expect(key.forPayload({ code: 'one' })).toBe(first)
    expect(key.forPayload({ code: 'two' })).not.toBe(first)
    key.complete()
    expect(key.forPayload({ code: 'one' })).not.toBe(first)
  })
})
