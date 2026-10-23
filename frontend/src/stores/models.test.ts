import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { catalog } from '../api/catalog'
import { defaultCapabilities, type ModelKind, type PublicModel } from '../api/catalog-contracts'
import { useModelStore } from './models'
import { useAuthStore } from './auth'
function model(id: string, type: ModelKind, isDefault = false): PublicModel {
  return {
    id,
    type,
    display_name: id,
    description: '',
    icon: '',
    sort_order: 0,
    is_default: isDefault,
    capabilities: defaultCapabilities(type),
  }
}
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())
describe('public model selection', () => {
  it('selects defaults independently and preserves valid selections across reloads', async () => {
    vi.spyOn(catalog, 'public').mockImplementation(async (kind) => ({
      items:
        kind === 'chat'
          ? [model('chat-a', 'chat'), model('chat-b', 'chat', true)]
          : [model('image-a', 'image', true)],
    }))
    const store = useModelStore()
    await store.load('chat')
    expect(store.selected.chat).toBe('chat-b')
    store.select('chat', 'chat-a')
    await store.load('image')
    await store.load('chat')
    expect(store.selected.chat).toBe('chat-a')
    expect(store.selected.image).toBe('image-a')
    store.select('chat', 'unavailable')
    expect(store.selected.chat).toBe('chat-a')
  })
  it('ignores late responses after a newer reload or an account reset', async () => {
    let complete: ((value: { items: PublicModel[] }) => void) | undefined
    vi.spyOn(catalog, 'public')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve
          }),
      )
      .mockResolvedValueOnce({ items: [model('new', 'chat', true)] })
    const store = useModelStore(),
      pending = store.load('chat')
    await store.load('chat')
    complete?.({ items: [model('old', 'chat', true)] })
    await pending
    expect(store.selected.chat).toBe('new')
    const auth = useAuthStore()
    auth.user = {
      id: 'new-account',
      email: 'new@lumi.test',
      nickname: 'Member',
      role: 'user',
      status: 'active',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      created_at: '2026-10-22T00:00:00Z',
      last_login_at: null,
      last_login_ip: '',
    }
    expect(store.items.chat).toEqual([])
    expect(store.selected.chat).toBe('')
  })
  it('clears unavailable selections and rejects a mixed-mode response', async () => {
    vi.spyOn(catalog, 'public')
      .mockResolvedValueOnce({ items: [model('old', 'chat', true)] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [model('wrong', 'image')] })
    const store = useModelStore()
    await store.load('chat')
    await store.load('chat')
    expect(store.selected.chat).toBe('')
    await store.load('chat')
    expect(store.items.chat).toEqual([])
    expect(store.errors.chat).toBeInstanceOf(Error)
  })
})
