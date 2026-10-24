import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { catalog } from '../api/catalog'
import { defaultCapabilities, type ModelKind, type PublicModel } from '../api/catalog-contracts'
import { createSessionService } from '../api/auth-session'
import { createAppRuntime, type AppRuntime } from '../react/app/runtime'
import { RuntimeContext } from '../react/app/context'
import { useModels } from '../react/features/catalog/models'

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
let runtime: AppRuntime, root: Root, host: HTMLDivElement
let observed:
  { chat: ReturnType<typeof useModels>; image: ReturnType<typeof useModels> } | undefined
function Probe() {
  const chat = useModels('chat'),
    image = useModels('image')
  observed = { chat, image }
  // Subscribe to the same tracked error/status properties consumed by the actual picker.
  return createElement(
    'output',
    {},
    chat.query.error?.message ?? chat.query.status,
    image.query.status,
  )
}
function values() {
  if (!observed) throw new Error('Hooks have not rendered')
  return observed
}
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    check()
  })
}
async function mount() {
  await act(async () => {
    root.render(
      createElement(
        RuntimeContext.Provider,
        { value: runtime },
        createElement(QueryClientProvider, { client: runtime.queryClient }, createElement(Probe)),
      ),
    )
  })
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'memory-only-test',
            token_type: 'Bearer',
            expires_in: 900,
            user: {
              id: '019a0000-0000-7000-8000-000000000001',
              email: 'member@lumi.test',
              nickname: 'Member',
              role: 'user',
              status: 'active',
              locale: 'zh-CN',
              timezone: 'UTC',
              created_at: '2026-10-22T00:00:00Z',
              last_login_at: null,
              last_login_ip: '',
            },
          }),
        ),
    ),
  )
  runtime = createAppRuntime(createSessionService())
  runtime.queryClient.setDefaultOptions({ queries: { retry: false } })
  await runtime.session.login({ email: 'member@lumi.test', password: 'TestOnlyPassword42' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  observed = undefined
})
afterEach(async () => {
  await act(async () => root.unmount())
  runtime.dispose()
  host.remove()
  vi.restoreAllMocks()
})

describe('public model selection', () => {
  it('selects defaults independently and preserves valid selections across reloads', async () => {
    vi.spyOn(catalog, 'public').mockImplementation(async (kind) => ({
      items:
        kind === 'chat'
          ? [model('chat-a', 'chat'), model('chat-b', 'chat', true)]
          : [model('image-a', 'image', true)],
    }))
    await mount()
    await settle(() => {
      expect(values().chat.selected?.id).toBe('chat-b')
      expect(values().image.selected?.id).toBe('image-a')
    })
    await act(async () => values().chat.select('chat-a'))
    await act(async () => {
      await values().image.query.refetch()
      await values().chat.query.refetch()
    })
    expect(values().chat.selected?.id).toBe('chat-a')
    expect(values().image.selected?.id).toBe('image-a')
    await act(async () => values().chat.select('unavailable'))
    expect(values().chat.selected?.id).toBe('chat-a')
  })
  it('ignores late responses after a newer reload or an account reset', async () => {
    const read = vi
      .spyOn(catalog, 'public')
      .mockImplementation(async (kind) => ({ items: [model('seed-' + kind, kind, true)] }))
    await mount()
    await settle(() => expect(values().chat.selected?.id).toBe('seed-chat'))
    let complete: ((value: { items: PublicModel[] }) => void) | undefined
    read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve
          }),
      )
      .mockResolvedValueOnce({ items: [model('new', 'chat', true)] })
    let pending: ReturnType<ReturnType<typeof useModels>['query']['refetch']> | undefined
    await act(async () => {
      pending = values().chat.query.refetch()
    })
    await act(async () => {
      await values().chat.query.refetch()
    })
    await settle(() => expect(values().chat.selected?.id).toBe('new'))
    await act(async () => {
      complete?.({ items: [model('old', 'chat', true)] })
      await pending
    })
    expect(values().chat.selected?.id).toBe('new')
    await act(async () => runtime.session.clear())
    expect(values().chat.items).toEqual([])
    expect(runtime.modelStore.getState().selected.chat).toBe('')
  })
  it('clears unavailable selections and rejects a mixed-mode response', async () => {
    const read = vi.spyOn(catalog, 'public').mockImplementation(async (kind) => ({
      items: kind === 'chat' ? [model('old', 'chat', true)] : [],
    }))
    await mount()
    await settle(() => expect(values().chat.selected?.id).toBe('old'))
    read.mockImplementation(async () => ({ items: [] }))
    await act(async () => {
      await values().chat.query.refetch()
    })
    await settle(() => expect(values().chat.selected).toBeUndefined())
    read.mockImplementation(async (kind) => ({
      items: kind === 'chat' ? [model('wrong', 'image')] : [],
    }))
    await act(async () => {
      await values().chat.query.refetch()
    })
    await settle(() => expect(values().chat.query.error).toBeInstanceOf(Error))
    expect(values().chat.items).toEqual([])
  })
})
