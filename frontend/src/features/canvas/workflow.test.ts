import { describe, expect, it } from 'vitest'
import { connect } from './commands'
import { documentProblem, imageNode } from './document'
import { decodeFragment, encodeFragment } from './clipboard'
import { extractFragment } from './commands'
import { emptyHistory, patch, record, redo, undo } from './history'
import { buildPrompt, collectInputs, generatorFromSelection } from './workflow'
import { ids, must, sampleDocument, sequence } from './test-fixtures'

describe('canvas workflow', () => {
  it('collects references and text through edges and groups', () => {
    const doc = connect(sampleDocument(), ids.loose, ids.generator)
    expect(collectInputs(doc, ids.generator)).toEqual({
      references: [ids.file, ids.looseFile],
      texts: ['暖色调'],
      unavailable: 0,
    })
    const missing = collectInputs(doc, ids.generator, (file) => file !== ids.looseFile)
    expect(missing).toMatchObject({ references: [ids.file], unavailable: 1 })
    expect(buildPrompt(' 一只猫 ', ['暖色调', '胶片'])).toBe('一只猫\n\n暖色调\n\n胶片')
    expect(buildPrompt('', [])).toBe('')
  })

  it('creates a connected generator from a selection', () => {
    const { doc, generator } = generatorFromSelection(
      sampleDocument(),
      [ids.group, ids.image, ids.loose],
      sequence(),
    )
    expect(generator).not.toBeNull()
    expect(documentProblem(doc)).toBe('')
    const inputs = doc.edges.filter((edge) => edge.to === generator).map((edge) => edge.from)
    expect(inputs.sort()).toEqual([ids.group, ids.loose].sort())
    expect(generatorFromSelection(sampleDocument(), [ids.generator]).generator).toBeNull()
  })
})

describe('canvas history and clipboard', () => {
  it('coalesces keyed changes and patches every snapshot', () => {
    let history = emptyHistory<number>()
    history = record(history, 1, 'type', 1000)
    history = record(history, 2, 'type', 1500)
    history = record(history, 3, '', 1600)
    expect(history.past).toEqual([1, 3])
    const back = must(undo(history, 4))
    expect(back.value).toBe(3)
    const forward = must(redo(back.history, 3))
    expect(forward.value).toBe(4)
    expect(patch(back.history, (value) => value * 10).future).toEqual([40])
    expect(undo(emptyHistory<number>(), 0)).toBeNull()
  })

  it('round-trips fragments and rejects tampered text', () => {
    const fragment = extractFragment(sampleDocument(), [ids.loose])
    expect(decodeFragment(encodeFragment(fragment))).toEqual(fragment)
    expect(decodeFragment('hello')).toBeNull()
    expect(decodeFragment('lumi-canvas/v1:{bad')).toBeNull()
    const broken = { nodes: [imageNode({ x: 0, y: 0 }, { state: 'ready' })], edges: [] }
    expect(decodeFragment(encodeFragment(broken))).toBeNull()
  })
})
