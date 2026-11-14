import { describe, expect, it } from 'vitest'
import {
  carriesFiles,
  dragDepth,
  pickEditModel,
  referenceCapacity,
  referenceProblem,
  screenFiles,
} from './reference-rules'

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type })

const model = (supports_edit: boolean, max_reference_images = 4) => ({
  capabilities: { supports_edit, max_reference_images } as never,
})

describe('reference rules', () => {
  it('screens files by type, size and remaining slots', () => {
    const result = screenFiles(
      [
        file('a.png', 'image/png'),
        file('b.gif', 'image/gif'),
        file('c.jpg', 'image/jpeg', 50),
        file('d.webp', 'image/webp'),
        file('e.png', 'image/png'),
        file('f.txt', 'text/plain'),
      ],
      2,
      20,
    )
    expect(result.accepted.map((value) => value.name)).toEqual(['a.png', 'd.webp'])
    expect(result.rejected).toEqual({ type: 2, size: 1, limit: 1 })
  })

  it('treats negative availability as full', () => {
    expect(screenFiles([file('a.png', 'image/png')], -1).rejected.limit).toBe(1)
  })

  it('derives capacity only for edit-capable models', () => {
    expect(referenceCapacity({ max_references: 3 }, model(true, 4))).toBe(3)
    expect(referenceCapacity({ max_references: 4 }, model(true, 2))).toBe(2)
    expect(referenceCapacity({ max_references: 4 }, model(false))).toBe(0)
    expect(referenceCapacity(undefined, model(true))).toBe(0)
    expect(referenceCapacity({ max_references: 4 }, undefined)).toBe(0)
  })

  it('prefers the selected edit-capable model', () => {
    const plain = model(false),
      edit = model(true),
      other = model(true)
    expect(pickEditModel(edit, [plain, other, edit])).toBe(edit)
    expect(pickEditModel(plain, [plain, other, edit])).toBe(other)
    expect(pickEditModel(plain, [plain])).toBeUndefined()
  })

  it('validates existing references in the original order', () => {
    expect(referenceProblem({ id: 'a', size: 1 }, ['a'], 1, 10)).toBe('duplicate')
    expect(referenceProblem({ id: 'b', size: 99 }, [], 4, 10)).toBe('size')
    expect(referenceProblem({ id: 'b', size: 1 }, [], 4, undefined)).toBe('size')
    expect(referenceProblem({ id: 'b', size: 1 }, ['a'], 1, 10)).toBe('limit')
    expect(referenceProblem({ id: 'b', size: 1 }, ['a'], 2, 10)).toBeNull()
  })

  it('counts nested drag enter and leave without going negative', () => {
    let depth = 0
    depth = dragDepth(depth, 'enter')
    depth = dragDepth(depth, 'enter')
    depth = dragDepth(depth, 'leave')
    expect(depth).toBe(1)
    depth = dragDepth(depth, 'leave')
    depth = dragDepth(depth, 'leave')
    expect(depth).toBe(0)
    expect(dragDepth(5, 'reset')).toBe(0)
  })

  it('recognizes file drags only', () => {
    expect(carriesFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true)
    expect(carriesFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false)
    expect(carriesFiles(null)).toBe(false)
  })
})
