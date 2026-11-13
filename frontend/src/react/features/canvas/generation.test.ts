import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { images, type ImageTask } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { ids, must, sampleDocument } from '../../../features/canvas/test-fixtures'
import { task as baseTask } from '../../../features/images/test-fixtures'
import { createCanvasEditor } from './editor'
import { createCanvasGeneration, type GenerationRequest } from './generation'
import { canvasFixture, conversationId, deferred, fileFixture } from './test-canvas'

vi.mock('../../../api/images', async (original) => {
  const actual = await original<typeof import('../../../api/images')>()
  return {
    ...actual,
    images: {
      ...actual.images,
      submit: vi.fn(),
      task: vi.fn(),
      events: vi.fn(),
      cancel: vi.fn(),
    },
  }
})

const newTask = '30000000-0000-4000-8000-000000000002'
const result = fileFixture('20000000-0000-4000-8000-000000000010', 1600, 800)

function task(change: Partial<ImageTask> = {}): ImageTask {
  return {
    ...baseTask,
    id: newTask,
    conversation_id: conversationId,
    status: 'queued',
    n: 2,
    items: [],
    ...change,
  }
}

const succeeded = (id = newTask) =>
  task({
    id,
    status: 'partial',
    items: [
      { position: 0, status: 'succeeded', file_id: result.id, file: result, error_code: '' },
      { position: 1, status: 'failed', file_id: null, file: null, error_code: 'IMAGE_BLOCKED' },
    ],
  })

const request: GenerationRequest = {
  generator: ids.generator,
  modelId: 'model',
  prompt: '一只猫',
  quality: 'medium',
  size: '1024x512',
  ratio: '',
  n: 2,
  references: [ids.file],
  aspect: 2,
}

function setup() {
  // The sample's own pending slot is settled so only new tasks are followed.
  const doc = sampleDocument()
  doc.nodes = doc.nodes.filter((node) => node.id !== ids.output)
  doc.edges = doc.edges.filter((edge) => edge.to !== ids.output)
  const editor = createCanvasEditor(canvasFixture({ document: doc }))
  const changed = vi.fn()
  const wait = vi.fn(() => Promise.resolve())
  const generation = createCanvasGeneration(editor, { changed, wait })
  const stop = generation.mount()
  return { editor, generation, changed, wait, stop }
}

const slots = (doc: ReturnType<typeof sampleDocument>) =>
  doc.nodes.filter((node) => node.image?.task_id === newTask)

describe('canvas generation', () => {
  beforeEach(() => {
    vi.mocked(images.events).mockImplementation(() => new Promise(() => {}))
  })
  afterEach(() => {
    vi.resetAllMocks()
    vi.useRealTimers()
  })

  it('shows placeholders while submitting, then connected slots that settle', async () => {
    let push: (task: ImageTask) => void = () => {}
    vi.mocked(images.events).mockImplementation((_id, _signal, onTask) => {
      push = onTask
      return new Promise(() => {})
    })
    const pending = deferred<ImageTask>()
    vi.mocked(images.submit).mockReturnValue(pending.promise)
    const { editor, generation, changed } = setup()
    const done = generation.submit(request)
    expect(editor.state.placeholders.map((item) => item.kind)).toEqual(['submit', 'submit'])

    pending.resolve(task())
    expect(await done).toBe(true)
    const input = must(vi.mocked(images.submit).mock.calls[0])[0]
    expect(input).toMatchObject({
      conversation_id: conversationId,
      prompt: '一只猫',
      n: 2,
      reference_file_ids: [ids.file],
    })
    expect(editor.state.placeholders).toEqual([])
    expect(slots(editor.state.doc).map((node) => node.image?.state)).toEqual(['pending', 'pending'])
    const outputs = editor.state.doc.edges.filter((edge) => edge.from === ids.generator)
    expect(outputs).toHaveLength(2)
    expect(changed).toHaveBeenCalledTimes(1)

    push(succeeded())
    const [ready, failed] = slots(editor.state.doc)
    expect(ready?.image).toMatchObject({ state: 'ready', file_id: result.id })
    expect(ready?.h).toBe(Math.round(must(ready).w / 2))
    expect(failed?.image).toMatchObject({ state: 'failed', error_code: 'IMAGE_BLOCKED' })
    expect(editor.state.files[result.id]).toEqual(result)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('never brings a placeholder back through undo once a result settled', async () => {
    vi.mocked(images.submit).mockResolvedValue(task())
    const { editor, generation } = setup()
    await generation.submit(request)
    editor.setTitle('改名')
    editor.patchEverywhere((doc) => doc)
    vi.mocked(images.events).mock.calls[0]?.[2](succeeded())
    editor.undo()
    expect(slots(editor.state.doc)).toEqual([])
    editor.redo()
    expect(slots(editor.state.doc).map((node) => node.image?.state)).toEqual(['ready', 'failed'])
  })

  it('removes placeholders and reports errors when nothing was charged', async () => {
    vi.mocked(images.submit).mockRejectedValue(new ApiError('INSUFFICIENT_CREDITS', 402))
    const { editor, generation, changed } = setup()
    const before = editor.state.doc
    expect(await generation.submit(request)).toBe(false)
    expect(editor.state.placeholders).toEqual([])
    expect(editor.state.doc).toBe(before)
    expect(editor.state.notice?.error).toBeInstanceOf(ApiError)
    expect(changed).not.toHaveBeenCalled()
    expect(images.submit).toHaveBeenCalledTimes(1)
  })

  it('replays an unknown outcome with the same idempotency key', async () => {
    vi.mocked(images.submit)
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR'))
      .mockRejectedValueOnce(new ApiError('UPSTREAM', 503))
      .mockResolvedValueOnce(task())
    const { generation, wait } = setup()
    expect(await generation.submit(request)).toBe(true)
    const keys = vi.mocked(images.submit).mock.calls.map((call) => call[1])
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('refuses to run past the node limit', async () => {
    vi.mocked(images.submit).mockResolvedValue(task())
    const { editor, generation } = setup()
    expect(await generation.submit({ ...request, n: 10 })).toBe(true)
    vi.mocked(images.submit).mockClear()
    const crowded = { ...request, n: 500 }
    expect(await generation.submit(crowded)).toBe(false)
    expect(images.submit).not.toHaveBeenCalled()
    expect(editor.state.notice?.key).toBe('canvas.editor.limit')
  })

  it('resumes pending slots on mount and falls back to polling', async () => {
    vi.useFakeTimers()
    vi.mocked(images.events).mockRejectedValue(new ApiError('NETWORK_ERROR'))
    vi.mocked(images.task)
      .mockResolvedValueOnce(task({ id: ids.task, status: 'running' }))
      .mockResolvedValueOnce(succeeded(ids.task))
    const editor = createCanvasEditor(canvasFixture({ document: sampleDocument() }))
    const stop = createCanvasGeneration(editor, { changed: vi.fn() }).mount()
    expect(images.events).toHaveBeenCalledWith(
      ids.task,
      expect.any(AbortSignal),
      expect.any(Function),
    )
    await vi.advanceTimersByTimeAsync(3000)
    expect(images.task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(images.task).toHaveBeenCalledTimes(2)
    const output = editor.state.doc.nodes.find((node) => node.id === ids.output)
    expect(output?.image).toMatchObject({ state: 'ready', file_id: result.id })
    await vi.advanceTimersByTimeAsync(30000)
    expect(images.task).toHaveBeenCalledTimes(2)
    stop()
  })

  it('marks slots failed when their task is gone and stops on unmount', async () => {
    vi.useFakeTimers()
    vi.mocked(images.events).mockResolvedValue(undefined)
    vi.mocked(images.task).mockRejectedValue(new ApiError('IMAGE_TASK_NOT_FOUND', 404))
    const editor = createCanvasEditor(canvasFixture({ document: sampleDocument() }))
    const stop = createCanvasGeneration(editor, { changed: vi.fn() }).mount()
    await vi.advanceTimersByTimeAsync(0)
    const output = editor.state.doc.nodes.find((node) => node.id === ids.output)
    expect(output?.image).toMatchObject({ state: 'failed', error_code: 'IMAGE_TASK_NOT_FOUND' })
    stop()
    const signal = must(vi.mocked(images.events).mock.calls[0])[1]
    expect(signal.aborted).toBe(true)
  })
})
