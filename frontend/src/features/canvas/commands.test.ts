import { describe, expect, it } from 'vitest'
import {
  cascade,
  addNodes,
  aspectResize,
  bringToFront,
  canConnect,
  capacity,
  connect,
  extractFragment,
  groupNodes,
  insertFragment,
  moveNodes,
  removeEdges,
  removeNodes,
  reparent,
  ungroup,
} from './commands'
import { documentProblem, emptyDocument, LIMITS, textNode, videoNode } from './document'
import { ids, must, sampleDocument, sequence } from './test-fixtures'

const find = (doc: ReturnType<typeof sampleDocument>, id: string) =>
  doc.nodes.find((node) => node.id === id)

describe('canvas commands', () => {
  it('connects text, images and ready videos to a video node', () => {
    const doc = sampleDocument()
    const target = videoNode({ x: 900, y: 90 }, '25876eca-7a4f-4ee3-8046-6a8adfb1aaa1')
    const source = videoNode({ x: 600, y: 90 }, '25876eca-7a4f-4ee3-8046-6a8adfb1aaa2')
    const ready = {
      ...source,
      video: {
        state: 'ready' as const,
        file_id: '25876eca-7a4f-4ee3-8046-6a8adfb1aaa3',
        task_id: null,
        position: null,
        error_code: '',
      },
    }
    const board = { ...doc, nodes: [...doc.nodes, target, ready] }
    expect(canConnect(board, ids.image, target.id)).toBe(true)
    expect(canConnect(board, ids.text, target.id)).toBe(true)
    expect(canConnect(board, ready.id, target.id)).toBe(true)
    expect(canConnect(board, target.id, ids.generator)).toBe(false)
  })
  it('moves group members with their frame', () => {
    const doc = moveNodes(sampleDocument(), [ids.group], 10, -5)
    expect(find(doc, ids.group)).toMatchObject({ x: -30, y: -85 })
    expect(find(doc, ids.image)).toMatchObject({ x: 10, y: -5 })
    expect(find(doc, ids.generator)).toMatchObject({ x: 500, y: 0 })
    expect(moveNodes(doc, [ids.text], 0, 0)).toBe(doc)
  })

  it('keeps members and drops dangling edges when removing nodes', () => {
    const doc = removeNodes(sampleDocument(), [ids.group])
    expect(find(doc, ids.image)?.group_id).toBeNull()
    expect(doc.edges.map((edge) => edge.to)).toEqual([ids.output])
    expect(documentProblem(doc)).toBe('')
    expect(removeEdges(doc, [must(doc.edges[0]).id]).edges).toEqual([])
  })

  it('connects only valid, new pairs', () => {
    const doc = sampleDocument()
    expect(canConnect(doc, ids.loose, ids.generator)).toBe(true)
    expect(canConnect(doc, ids.group, ids.generator)).toBe(false)
    expect(canConnect(doc, ids.text, ids.loose)).toBe(true)
    expect(canConnect(doc, ids.generator, ids.generator)).toBe(false)
    const connected = connect(doc, ids.loose, ids.generator, '40000000-0000-4000-8000-000000000009')
    expect(connected.edges).toHaveLength(3)
    expect(connect(connected, ids.loose, ids.generator)).toBe(connected)
  })

  it('groups, ungroups and reparents nodes', () => {
    const { doc, group } = groupNodes(
      sampleDocument(),
      [ids.loose, ids.generator],
      '新分组',
      '50000000-0000-4000-8000-000000000001',
    )
    expect(group).not.toBeNull()
    expect(doc.nodes[0]?.id).toBe(group)
    expect(find(doc, ids.loose)?.group_id).toBe(group)
    expect(find(doc, ids.generator)?.group_id).toBe(group)
    expect(documentProblem(doc)).toBe('')
    const freed = ungroup(doc, [must(group)])
    expect(find(freed, ids.loose)?.group_id).toBeNull()
    const outside = reparent(moveNodes(sampleDocument(), [ids.text], 5000, 0), [ids.text])
    expect(find(outside, ids.text)?.group_id).toBeNull()
    const inside = reparent(moveNodes(sampleDocument(), [ids.loose], 450, 0), [ids.loose])
    expect(find(inside, ids.loose)?.group_id).toBe(ids.group)
  })

  it('resizes with a locked aspect ratio and raises nodes', () => {
    expect(aspectResize({ x: 0, y: 0, w: 200, h: 100 }, 300, 10)).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 150,
    })
    const raised = bringToFront(sampleDocument(), [ids.image])
    expect(raised.nodes.at(-1)?.id).toBe(ids.image)
  })

  it('respects the node limit', () => {
    let doc = emptyDocument()
    doc = addNodes(
      doc,
      Array.from({ length: LIMITS.nodes }, () => textNode({ x: 0, y: 0 })),
    )
    expect(capacity(doc)).toBe(0)
    expect(addNodes(doc, [textNode({ x: 0, y: 0 })])).toBe(doc)
  })

  it('copies fragments with fresh IDs and no task links', () => {
    const source = sampleDocument()
    const fragment = extractFragment(source, [ids.group, ids.generator, ids.output])
    // Pending results are skipped; group members come along with the frame.
    expect(fragment.nodes.map((node) => node.id)).toEqual([
      ids.group,
      ids.image,
      ids.text,
      ids.generator,
    ])
    expect(fragment.edges).toHaveLength(1)
    const lone = extractFragment(source, [ids.text])
    expect(lone.nodes[0]?.group_id).toBeNull()
    const { doc, ids: pasted } = insertFragment(source, fragment, { x: 40, y: 40 }, sequence())
    expect(pasted).toHaveLength(4)
    expect(doc.nodes).toHaveLength(source.nodes.length + 4)
    expect(documentProblem(doc)).toBe('')
    const copiedImage = doc.nodes.find((node) => node.id === pasted[1])
    expect(copiedImage).toMatchObject({ x: 40, y: 40, group_id: pasted[0] })
    expect(copiedImage?.image).toMatchObject({ file_id: ids.file, task_id: null, position: null })
  })
})

describe('cascade', () => {
  it('offsets inserts that would stack on an existing center', () => {
    const doc = { ...emptyDocument(), nodes: [textNode({ x: 0, y: 0, w: 100, h: 100 })] }
    expect(cascade(doc, { x: 0, y: 0, w: 100, h: 100 })).toMatchObject({ x: 32, y: 32 })
    expect(cascade(doc, { x: -50, y: -50, w: 200, h: 200 })).toMatchObject({ x: -18, y: -18 })
    expect(cascade(doc, { x: 300, y: 0, w: 100, h: 100 })).toMatchObject({ x: 300, y: 0 })
    const stacked = {
      ...doc,
      nodes: [...doc.nodes, textNode({ x: 32, y: 32, w: 100, h: 100 })],
    }
    expect(cascade(stacked, { x: 0, y: 0, w: 100, h: 100 })).toMatchObject({ x: 64, y: 64 })
  })
})
