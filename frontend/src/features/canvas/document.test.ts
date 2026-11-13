import { describe, expect, it } from 'vitest'
import type { CanvasDocument } from '../../api/canvases'
import { parseCanvas, parseDocument } from '../../api/canvases'
import {
  connectable,
  documentProblem,
  emptyDocument,
  fileIds,
  fitImage,
  LIMITS,
  pendingTasks,
  textNode,
} from './document'
import { ids, must, sampleDocument } from './test-fixtures'

function mutate(change: (doc: CanvasDocument) => void) {
  const doc = structuredClone(sampleDocument())
  change(doc)
  return documentProblem(doc)
}

describe('canvas document rules', () => {
  it('accepts a complete document and lists references', () => {
    expect(documentProblem(emptyDocument())).toBe('')
    expect(documentProblem(sampleDocument())).toBe('')
    expect(fileIds(sampleDocument())).toEqual([ids.file, ids.looseFile])
    expect(pendingTasks(sampleDocument())).toEqual([ids.task])
  })

  it('rejects what the server would reject', () => {
    expect(mutate((d) => (d.viewport.zoom = 5))).toBe('viewport')
    expect(mutate((d) => (must(d.nodes[1]).id = ids.group))).toBe('node-id')
    expect(mutate((d) => (must(d.nodes[2]).w = 1))).toBe('geometry')
    expect(mutate((d) => (must(d.nodes[0]).title = 'a\nb'))).toBe('title')
    expect(mutate((d) => (must(must(d.nodes[2]).text).content = 'x'.repeat(LIMITS.text + 1)))).toBe(
      'text',
    )
    expect(mutate((d) => (must(must(d.nodes[2]).text).content = 'bell\u0007'))).toBe('text')
    expect(mutate((d) => (must(d.nodes[0]).group_id = ids.group))).toBe('group')
    expect(mutate((d) => (must(must(d.nodes[3]).generator).n = 11))).toBe('count')
    expect(mutate((d) => (must(must(d.nodes[3]).generator).size = 'large'))).toBe('size')
    expect(mutate((d) => (must(must(d.nodes[4]).image).position = null))).toBe('image')
    expect(mutate((d) => (must(must(d.nodes[1]).image).position = 0))).toBe('position')
    expect(mutate((d) => (must(must(d.nodes[1]).image).file_id = null))).toBe('image')
    expect(mutate((d) => d.edges.push({ ...must(d.edges[0]), id: crypto.randomUUID() }))).toBe(
      'edge',
    )
    expect(
      mutate((d) => d.edges.push({ id: crypto.randomUUID(), from: ids.text, to: ids.output })),
    ).toBe('edge')
  })

  it('allows only input and result edge directions', () => {
    expect(connectable('image', 'generator')).toBe(true)
    expect(connectable('group', 'generator')).toBe(true)
    expect(connectable('generator', 'image')).toBe(true)
    expect(connectable('generator', 'generator')).toBe(false)
    expect(connectable('text', 'image')).toBe(false)
    expect(connectable(undefined, 'generator')).toBe(false)
  })

  it('keeps multiline text and sizes images by aspect ratio', () => {
    expect(
      documentProblem({ ...emptyDocument(), nodes: [textNode({ x: 0, y: 0 }, 'a\n\tb')] }),
    ).toBe('')
    expect(fitImage(1600, 800)).toEqual({ w: 320, h: 160 })
    expect(fitImage(0, 0)).toEqual({ w: 320, h: 320 })
  })

  it('parses server canvases strictly', () => {
    const doc = sampleDocument()
    expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    expect(() => parseDocument({ ...doc, schema: 2 })).toThrow('RESPONSE_INVALID')
    expect(() => parseDocument({ ...doc, viewport: { x: 0, y: 0, zoom: 'x' } })).toThrow()
    const canvas = parseCanvas({
      id: 'c',
      title: '',
      conversation_id: 'v',
      document: doc,
      files: [],
      node_count: doc.nodes.length,
      version: 3,
      created_at: '2026-11-14T00:00:00Z',
      updated_at: '2026-11-14T00:00:00Z',
    })
    expect(canvas.version).toBe(3)
    expect(canvas.document.nodes[3]?.generator?.prompt).toBe('一只猫')
  })
})
