import { describe, expect, it } from 'vitest'
import { emptyHistory, HISTORY_LIMIT, patch, record, redo, undo } from './history'

describe('canvas history', () => {
  it('undoes and redoes snapshots in order', () => {
    let history = record(emptyHistory<number>(), 1, '', 0)
    history = record(history, 2, '', 10)
    const first = undo(history, 3)
    expect(first?.value).toBe(2)
    const second = undo(first?.history ?? history, 2)
    expect(second?.value).toBe(1)
    expect(second && undo(second.history, 1)).toBeNull()
    const again = redo(second?.history ?? history, 1)
    expect(again?.value).toBe(2)
    expect(again?.history.past).toEqual([1])
  })

  it('collapses records with the same key inside the window only', () => {
    let history = record(emptyHistory<string>(), 'a', 'type:x', 0)
    history = record(history, 'ab', 'type:x', 500)
    history = record(history, 'abc', 'type:x', 1200)
    expect(history.past).toEqual(['a'])
    history = record(history, 'abcd', 'type:x', 2300)
    expect(history.past).toEqual(['a', 'abcd'])
    history = record(history, 'move', 'move:y', 2400)
    expect(history.past).toEqual(['a', 'abcd', 'move'])
  })

  it('clears redo on a new record and keeps the limit', () => {
    let history = emptyHistory<number>()
    for (let index = 0; index < HISTORY_LIMIT + 5; index++) history = record(history, index)
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    expect(history.past[0]).toBe(5)
    const back = undo(history, 99)
    expect(back?.history.future).toEqual([99])
    expect(back && record(back.history, 1).future).toEqual([])
  })

  it('patches every snapshot', () => {
    let history = record(emptyHistory<number>(), 1)
    history = record(history, 2)
    const back = undo(history, 3)
    const patched = patch(back?.history ?? history, (value) => value * 10)
    expect(patched.past).toEqual([10])
    expect(patched.future).toEqual([30])
  })
})
