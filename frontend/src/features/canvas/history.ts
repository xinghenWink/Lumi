/**
 * Snapshot undo history. Consecutive records with the same key inside the coalescing
 * window (typing into one text node, nudging with arrow keys) collapse into one step.
 */
export interface History<T> {
  past: readonly T[]
  future: readonly T[]
  key: string
  at: number
}

export const HISTORY_LIMIT = 50
const COALESCE_MS = 1000

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], key: '', at: 0 }
}

/** Records the state before a change. */
export function record<T>(history: History<T>, before: T, key = '', now = Date.now()): History<T> {
  if (key && key === history.key && now - history.at < COALESCE_MS)
    return { ...history, future: [], at: now }
  return {
    past: [...history.past, before].slice(-HISTORY_LIMIT),
    future: [],
    key,
    at: now,
  }
}

export function undo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  const value = history.past.at(-1)
  if (value === undefined) return null
  return {
    value,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
      key: '',
      at: 0,
    },
  }
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  const value = history.future[0]
  if (value === undefined) return null
  return {
    value,
    history: { past: [...history.past, current], future: history.future.slice(1), key: '', at: 0 },
  }
}

/**
 * Applies a change to every stored snapshot. Generation results use this so undo and redo
 * never resurrect a placeholder after its paid image has arrived.
 */
export function patch<T>(history: History<T>, change: (value: T) => T): History<T> {
  return { ...history, past: history.past.map(change), future: history.future.map(change) }
}
