import { describe, expect, it } from 'vitest'
import { decodeFragment, encodeFragment } from './clipboard'
import { extractFragment, insertFragment } from './commands'
import { documentProblem, emptyDocument } from './document'
import { ids, sampleDocument, sequence } from './test-fixtures'

describe('canvas clipboard', () => {
  it('round-trips a fragment through tagged text', () => {
    const fragment = extractFragment(sampleDocument(), [ids.group, ids.generator])
    const text = encodeFragment(fragment)
    expect(text.startsWith('lumi-canvas/v2:')).toBe(true)
    const decoded = decodeFragment(text)
    expect(decoded).toEqual(fragment)
    const pasted = insertFragment(
      emptyDocument(),
      decoded ?? fragment,
      { x: 40, y: 40 },
      sequence(),
    )
    expect(pasted.ids).toHaveLength(fragment.nodes.length)
    expect(documentProblem(pasted.doc)).toBe('')
  })

  it('ignores unrelated, malformed and invalid text', () => {
    expect(decodeFragment('hello')).toBeNull()
    expect(decodeFragment('lumi-canvas/v2:{')).toBeNull()
    expect(decodeFragment('lumi-canvas/v2:{"nodes":[],"edges":[]}')).toBeNull()
    const fragment = extractFragment(sampleDocument(), [ids.text])
    const broken = {
      ...fragment,
      edges: [{ id: ids.loose, from: ids.text, to: ids.text, kind: 'input' as const }],
    }
    expect(decodeFragment(encodeFragment(broken))).toBeNull()
    const oversized = 'lumi-canvas/v2:' + ' '.repeat(2 * 1024 * 1024)
    expect(decodeFragment(oversized)).toBeNull()
  })
})
