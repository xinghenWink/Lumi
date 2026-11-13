import type { Canvas } from '../../../api/canvases'
import type { ImageFile } from '../../../api/images'
import { emptyDocument } from '../../../features/canvas/document'

export const canvasId = '50000000-0000-4000-8000-000000000001'
export const conversationId = '50000000-0000-4000-8000-000000000002'

export function canvasFixture(change: Partial<Canvas> = {}): Canvas {
  return {
    id: canvasId,
    title: '',
    conversation_id: conversationId,
    document: emptyDocument(),
    files: [],
    node_count: 0,
    version: 1,
    created_at: '2026-11-14T00:00:00Z',
    updated_at: '2026-11-14T00:00:00Z',
    ...change,
  }
}

export function fileFixture(id: string, width = 1600, height = 900): ImageFile {
  return {
    id,
    kind: 'generated',
    mime: 'image/png',
    size: 10,
    width,
    height,
    thumbnail_width: 512,
    thumbnail_height: 288,
    url: '/api/v1/files/' + id + '?expires=1&sig=a',
    thumbnail_url: '/api/v1/files/' + id + '/thumb?expires=1&sig=a',
    expires_at: 1,
    created_at: '2026-11-14T00:00:00Z',
  }
}

/** A promise that the test settles by hand, to hold a request in flight. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
