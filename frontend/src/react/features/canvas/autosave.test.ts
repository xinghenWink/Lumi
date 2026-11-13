import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Canvas } from '../../../api/canvases'
import { ApiError } from '../../../api/transport'
import { addNodes } from '../../../features/canvas/commands'
import { textNode } from '../../../features/canvas/document'
import { createAutosave, type SaveBody } from './autosave'
import { createCanvasEditor } from './editor'
import { canvasFixture, deferred } from './test-canvas'

function setup(
  save: (body: SaveBody) => Promise<Canvas>,
  load = () => Promise.resolve(canvasFixture()),
) {
  const editor = createCanvasEditor(canvasFixture())
  const saveMock = vi.fn(save)
  const loadMock = vi.fn(load)
  const autosave = createAutosave(editor, {
    save: saveMock,
    load: loadMock,
    editDelay: 1000,
    viewDelay: 4000,
    retryDelays: [2000, 5000],
  })
  const stop = autosave.mount()
  const status = () => autosave.status.getState().status
  return { editor, autosave, save: saveMock, load: loadMock, stop, status }
}

const savedAs = (version: number) => (body: SaveBody) =>
  Promise.resolve(canvasFixture({ title: body.title, document: body.document, version }))

const addText = (content: string) => (doc: Canvas['document']) =>
  addNodes(doc, [textNode({ x: 0, y: 0 }, content)])

describe('canvas autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces edits into one save and adopts the new version', async () => {
    const { editor, save, status } = setup(savedAs(2))
    editor.setTitle('一')
    editor.apply(addText('a'))
    expect(status()).toBe('dirty')
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toMatchObject({ title: '一', version: 1 })
    expect(save.mock.calls[0]?.[0].document.nodes).toHaveLength(1)
    expect(status()).toBe('saved')
    expect(editor.state.version).toBe(2)
  })

  it('keeps one request in flight and saves edits made meanwhile afterwards', async () => {
    const first = deferred<Canvas>()
    const calls: SaveBody[] = []
    const { editor, status } = setup((body) => {
      calls.push(body)
      return calls.length === 1 ? first.promise : savedAs(3)(body)
    })
    editor.setTitle('一')
    await vi.advanceTimersByTimeAsync(1000)
    expect(status()).toBe('saving')
    editor.setTitle('二')
    first.resolve(canvasFixture({ version: 2 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(status()).toBe('dirty')
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ title: '二', version: 2 })
    expect(status()).toBe('saved')
  })

  it('sends the follow-up right away when its delay passed during the request', async () => {
    const first = deferred<Canvas>()
    const calls: SaveBody[] = []
    const { editor, status } = setup((body) => {
      calls.push(body)
      return calls.length === 1 ? first.promise : savedAs(3)(body)
    })
    editor.setTitle('一')
    await vi.advanceTimersByTimeAsync(1000)
    editor.setTitle('二')
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveLength(1)
    first.resolve(canvasFixture({ version: 2 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ title: '二', version: 2 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveLength(2)
    expect(status()).toBe('saved')
  })

  it('saves viewport-only changes on the slower schedule', async () => {
    const { editor, save } = setup(savedAs(2))
    editor.setViewport({ x: 10, y: 20, zoom: 2 })
    await vi.advanceTimersByTimeAsync(3999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save.mock.calls[0]?.[0].document.viewport).toEqual({ x: 10, y: 20, zoom: 2 })
  })

  it('backs off after network failures and recovers', async () => {
    let attempts = 0
    const { editor, save, status } = setup((body) => {
      attempts += 1
      return attempts === 1 ? Promise.reject(new ApiError('NETWORK_ERROR')) : savedAs(2)(body)
    })
    editor.setTitle('一')
    await vi.advanceTimersByTimeAsync(1000)
    expect(status()).toBe('retrying')
    await vi.advanceTimersByTimeAsync(1999)
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(2)
    expect(status()).toBe('saved')
  })

  it('pauses on a version conflict until the user keeps the server copy', async () => {
    const latest = canvasFixture({ title: '别处', version: 7 })
    const { editor, autosave, save, status } = setup(
      () => Promise.reject(new ApiError('CANVAS_CONFLICT', 409)),
      () => Promise.resolve(latest),
    )
    editor.setTitle('这里')
    await vi.advanceTimersByTimeAsync(1000)
    expect(status()).toBe('conflict')
    editor.setTitle('还在改')
    await vi.advanceTimersByTimeAsync(20000)
    expect(save).toHaveBeenCalledTimes(1)
    await autosave.resolve('theirs')
    expect(editor.state.title).toBe('别处')
    expect(editor.state.version).toBe(7)
    expect(status()).toBe('saved')
    expect(autosave.pending()).toBe(false)
  })

  it('overwrites the server copy with local edits when the user keeps theirs', async () => {
    let conflict = true
    const { editor, autosave, save, status } = setup(
      (body) => {
        if (conflict) return Promise.reject(new ApiError('CANVAS_CONFLICT', 409))
        return savedAs(body.version + 1)(body)
      },
      () => Promise.resolve(canvasFixture({ title: '别处', version: 7 })),
    )
    editor.setTitle('我的')
    await vi.advanceTimersByTimeAsync(1000)
    expect(status()).toBe('conflict')
    conflict = false
    await autosave.resolve('mine')
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ title: '我的', version: 7 }))
    expect(editor.state.version).toBe(8)
    expect(status()).toBe('saved')
  })

  it('stops on a deleted canvas and flushes pending edits on unmount', async () => {
    const { editor, save, stop, status } = setup(() =>
      Promise.reject(new ApiError('CANVAS_NOT_FOUND', 404)),
    )
    editor.setTitle('一')
    stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect(status()).toBe('missing')
    editor.setTitle('二')
    await vi.advanceTimersByTimeAsync(10000)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
