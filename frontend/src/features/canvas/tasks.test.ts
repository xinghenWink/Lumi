import { describe, expect, it } from 'vitest'
import type { ImageFile, ImageTask } from '../../api/images'
import { task as baseTask } from '../images/test-fixtures'
import { documentProblem } from './document'
import { applyTask } from './tasks'
import { ids, must, sampleDocument } from './test-fixtures'

const file: ImageFile = {
  id: '20000000-0000-4000-8000-000000000009',
  kind: 'generated',
  mime: 'image/png',
  size: 10,
  width: 1600,
  height: 900,
  thumbnail_width: 512,
  thumbnail_height: 288,
  url: '/api/v1/files/x?expires=1&sig=a',
  thumbnail_url: '/api/v1/files/x/thumb?expires=1&sig=a',
  expires_at: 1,
  created_at: '2026-11-14T00:00:00Z',
}

function task(change: Partial<ImageTask>): ImageTask {
  return { ...baseTask, id: ids.task, status: 'running', ...change }
}

describe('canvas task results', () => {
  it('settles pending slots from task items', () => {
    const running = applyTask(
      sampleDocument(),
      task({
        items: [{ position: 0, status: 'pending', file_id: null, file: null, error_code: '' }],
      }),
    )
    expect(running).toEqual(sampleDocument())
    const done = applyTask(
      sampleDocument(),
      task({
        status: 'succeeded',
        items: [{ position: 0, status: 'succeeded', file_id: file.id, file, error_code: '' }],
      }),
    )
    const output = must(done.nodes.find((node) => node.id === ids.output))
    expect(output.image).toMatchObject({ state: 'ready', file_id: file.id, task_id: ids.task })
    expect(output.h).toBeCloseTo((output.w * 900) / 1600)
    expect(documentProblem(done)).toBe('')
  })

  it('marks failed and canceled slots with a safe code', () => {
    const failed = applyTask(
      sampleDocument(),
      task({
        status: 'failed',
        items: [
          {
            position: 0,
            status: 'failed',
            file_id: null,
            file: null,
            error_code: 'UPSTREAM_ERROR',
          },
        ],
      }),
    )
    expect(must(failed.nodes.find((node) => node.id === ids.output)).image).toMatchObject({
      state: 'failed',
      error_code: 'UPSTREAM_ERROR',
    })
    const canceled = applyTask(sampleDocument(), task({ status: 'canceled', items: [] }))
    expect(must(canceled.nodes.find((node) => node.id === ids.output)).image?.error_code).toBe(
      'IMAGE_TASK_CANCELED',
    )
    const odd = applyTask(sampleDocument(), task({ status: 'failed', error_code: 'bad code' }))
    expect(must(odd.nodes.find((node) => node.id === ids.output)).image?.error_code).toBe(
      'IMAGE_GENERATION_FAILED',
    )
  })
})
