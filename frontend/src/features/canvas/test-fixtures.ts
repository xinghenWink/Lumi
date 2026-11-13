import type { CanvasDocument } from '../../api/canvases'
import { emptyDocument, generatorNode, groupNode, imageNode, textNode } from './document'

/** Deterministic UUIDs so expectations can name nodes. */
export function sequence(prefix = '00000000-0000-4000-8000-') {
  let next = 0
  return () => prefix + String(++next).padStart(12, '0')
}

export const ids = {
  group: '10000000-0000-4000-8000-000000000001',
  image: '10000000-0000-4000-8000-000000000002',
  text: '10000000-0000-4000-8000-000000000003',
  generator: '10000000-0000-4000-8000-000000000004',
  output: '10000000-0000-4000-8000-000000000005',
  loose: '10000000-0000-4000-8000-000000000006',
  file: '20000000-0000-4000-8000-000000000001',
  looseFile: '20000000-0000-4000-8000-000000000002',
  task: '30000000-0000-4000-8000-000000000001',
}

export function sampleDocument(): CanvasDocument {
  return {
    ...emptyDocument(),
    nodes: [
      groupNode({ x: -40, y: -80, w: 400, h: 520 }, '参考', ids.group),
      {
        ...imageNode(
          { x: 0, y: 0, w: 240, h: 180 },
          { state: 'ready', file_id: ids.file },
          ids.image,
        ),
        group_id: ids.group,
      },
      { ...textNode({ x: 0, y: 220 }, '暖色调', ids.text), group_id: ids.group },
      generatorNode({ x: 500, y: 0 }, { prompt: '一只猫' }, ids.generator),
      imageNode({ x: 900, y: 0 }, { state: 'pending', task_id: ids.task, position: 0 }, ids.output),
      imageNode({ x: -400, y: 0 }, { state: 'ready', file_id: ids.looseFile }, ids.loose),
    ],
    edges: [
      { id: '40000000-0000-4000-8000-000000000001', from: ids.group, to: ids.generator },
      { id: '40000000-0000-4000-8000-000000000002', from: ids.generator, to: ids.output },
    ],
  }
}

/** Narrows a value that a test expects to exist, failing loudly otherwise. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}
