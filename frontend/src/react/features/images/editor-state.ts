import { useState } from 'react'
import {
  changeMarks,
  emptyEditorHistory,
  stepMarks,
  type EditorMark,
  type EditorMode,
  type EditorPoint,
  type EditorRatio,
  type EditorTool,
  type EditorHistory,
} from './editor'

type EditorNote =
  { kind: 'comment'; at: EditorPoint; id?: number } | { kind: 'text'; at: EditorPoint }

export function useImageEditorDraft() {
  const [histories, setHistories] = useState(() => ({
    markup: emptyEditorHistory(),
    erase: emptyEditorHistory(),
  }))
  const [mode, setMode] = useState<EditorMode>()
  const [tool, setTool] = useState<EditorTool>()
  const [ratio, setRatio] = useState<EditorRatio>()
  const [color, setColor] = useState('#ef4444')
  const [brush, setBrush] = useState(10)
  const [prompt, setPrompt] = useState('')
  const [note, setNote] = useState<EditorNote>()
  const [busy, setBusy] = useState(false)
  const [submissionPending, setSubmissionPending] = useState(false)
  const layer = mode === 'erase' ? 'erase' : 'markup'
  const history = histories[layer]
  const dirty = !!(
    histories.markup.marks.length ||
    histories.erase.marks.length ||
    prompt.trim() ||
    note ||
    (mode === 'resize' && ratio) ||
    mode === 'remove_background'
  )

  function updateHistory(change: (state: EditorHistory) => EditorHistory) {
    setHistories((state) => ({ ...state, [layer]: change(state[layer]) }))
  }

  function select(next?: EditorMode, nextTool?: EditorTool) {
    setMode(next)
    setTool(nextTool)
    setNote(undefined)
  }

  function reset() {
    setHistories({ markup: emptyEditorHistory(), erase: emptyEditorHistory() })
    setMode(undefined)
    setTool(undefined)
    setRatio(undefined)
    setNote(undefined)
    setPrompt('')
    setSubmissionPending(false)
  }

  function add(mark: EditorMark) {
    updateHistory((state) => changeMarks(state, [...state.marks, mark]))
  }

  function saveNote(text: string) {
    const value = text.trim()
    if (!note || !value) return
    if (note.kind === 'text') {
      add({ ...note, text: value, color })
    } else {
      updateHistory((state) => {
        const id =
          note.id ??
          Math.max(0, ...state.marks.map((mark) => (mark.kind === 'comment' ? mark.id : 0))) + 1
        const mark: EditorMark = { kind: 'comment', at: note.at, id, text: value }
        return changeMarks(
          state,
          note.id === undefined
            ? [...state.marks, mark]
            : state.marks.map((item) => (item.kind === 'comment' && item.id === id ? mark : item)),
        )
      })
    }
    setNote(undefined)
  }

  function deleteComment(id: number) {
    updateHistory((state) =>
      changeMarks(
        state,
        state.marks.filter((mark) => mark.kind !== 'comment' || mark.id !== id),
      ),
    )
    if (note?.kind === 'comment' && note.id === id) setNote(undefined)
  }

  return {
    mode,
    tool,
    ratio,
    color,
    brush,
    prompt,
    note,
    busy,
    submissionPending,
    dirty,
    marks: history.marks,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    setRatio,
    setColor,
    setBrush,
    setPrompt,
    setNote,
    setBusy,
    setSubmissionPending,
    select,
    reset,
    add,
    saveNote,
    deleteComment,
    step: (direction: 'undo' | 'redo') => {
      updateHistory((state) => stepMarks(state, direction))
      setNote(undefined)
    },
  }
}

export type ImageEditorDraft = ReturnType<typeof useImageEditorDraft>
