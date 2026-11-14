import { createStore } from 'zustand/vanilla'
import type { Canvas, CanvasDocument, CanvasViewport } from '../../../api/canvases'
import type { ImageFile } from '../../../api/images'
import { clampCoordinate } from '../../../features/canvas/document'
import {
  emptyHistory,
  patch,
  record,
  redo,
  undo,
  type History,
} from '../../../features/canvas/history'
import type { Rect, Size } from '../../../features/canvas/geometry'

export type Tool = 'select' | 'hand'

/** Transient geometry shown while dragging; committed to the document on release. */
export type Preview =
  | { kind: 'move'; ids: ReadonlySet<string>; dx: number; dy: number }
  | { kind: 'resize'; id: string; rect: Rect }

/** An upload preview displayed until the file is ready. */
export interface Placeholder {
  id: string
  rect: Rect
  preview?: string
}

export interface Notice {
  key: string
  values?: Record<string, string | number>
  error?: unknown
}

export interface EditorState {
  canvasId: string
  title: string
  doc: CanvasDocument
  viewport: CanvasViewport
  version: number
  files: Readonly<Record<string, ImageFile>>
  selection: readonly string[]
  edgeSelection: readonly string[]
  tool: Tool
  history: History<CanvasDocument>
  preview: Preview | null
  placeholders: readonly Placeholder[]
  /** Increments on document or title edits; autosave compares it with what was saved. */
  revision: number
  /** Increments on viewport moves, which save on a slower schedule. */
  viewRevision: number
  editing: string | null
  /** Generator whose parameters are open in the bottom sheet on small screens. */
  inspector: string | null
  /** On-screen size of the viewport element, for centering and fitting. */
  stage: Size
  notice: Notice | null
}

export interface ApplyOptions {
  /** False keeps the change out of undo history (generation results, title edits). */
  record?: boolean
  /** Consecutive changes with the same key collapse into one undo step. */
  key?: string
}

function filesOf(list: readonly ImageFile[]) {
  return Object.fromEntries(list.map((file) => [file.id, file]))
}

function initial(canvas: Canvas): EditorState {
  return {
    canvasId: canvas.id,
    title: canvas.title,
    doc: canvas.document,
    viewport: canvas.document.viewport,
    version: canvas.version,
    files: filesOf(canvas.files),
    selection: [],
    edgeSelection: [],
    tool: 'hand',
    history: emptyHistory(),
    preview: null,
    placeholders: [],
    revision: 0,
    viewRevision: 0,
    editing: null,
    inspector: null,
    stage: { width: 0, height: 0 },
    notice: null,
  }
}

export function createCanvasEditor(canvas: Canvas) {
  const store = createStore<EditorState>(() => initial(canvas))
  const prune = (doc: CanvasDocument, state: EditorState) => {
    const nodes = new Set(doc.nodes.map((node) => node.id)),
      edges = new Set(doc.edges.map((edge) => edge.id))
    return {
      selection: state.selection.filter((id) => nodes.has(id)),
      edgeSelection: state.edgeSelection.filter((id) => edges.has(id)),
      editing: state.editing && nodes.has(state.editing) ? state.editing : null,
      inspector: state.inspector && nodes.has(state.inspector) ? state.inspector : null,
    }
  }
  const editor = {
    store,
    get state() {
      return store.getState()
    },
    /** Applies a pure document change; returns false when nothing changed. */
    apply(change: (doc: CanvasDocument) => CanvasDocument, options: ApplyOptions = {}) {
      const state = store.getState()
      const doc = change(state.doc)
      if (doc === state.doc) return false
      store.setState({
        doc,
        history:
          options.record === false ? state.history : record(state.history, state.doc, options.key),
        revision: state.revision + 1,
        ...prune(doc, state),
      })
      return true
    },
    /** Applies a change to the document and every undo snapshot (task results). */
    patchEverywhere(change: (doc: CanvasDocument) => CanvasDocument) {
      const state = store.getState()
      const doc = change(state.doc)
      store.setState({
        doc,
        history: patch(state.history, change),
        revision: doc === state.doc ? state.revision : state.revision + 1,
        ...prune(doc, state),
      })
    },
    undo() {
      const state = store.getState()
      const result = undo(state.history, state.doc)
      if (!result) return
      store.setState({
        doc: result.value,
        history: result.history,
        revision: state.revision + 1,
        preview: null,
        ...prune(result.value, state),
      })
    },
    redo() {
      const state = store.getState()
      const result = redo(state.history, state.doc)
      if (!result) return
      store.setState({
        doc: result.value,
        history: result.history,
        revision: state.revision + 1,
        preview: null,
        ...prune(result.value, state),
      })
    },
    setViewport(viewport: CanvasViewport) {
      store.setState((state) => ({
        viewport: { ...viewport, x: clampCoordinate(viewport.x), y: clampCoordinate(viewport.y) },
        viewRevision: state.viewRevision + 1,
      }))
    },
    setTitle(title: string) {
      store.setState((state) => ({ title, revision: state.revision + 1 }))
    },
    select(ids: readonly string[], mode: 'replace' | 'toggle' | 'add' = 'replace') {
      store.setState((state) => {
        if (mode === 'replace') return { selection: [...ids], edgeSelection: [] }
        const current = new Set(state.selection)
        for (const id of ids) {
          if (mode === 'toggle' && current.has(id)) current.delete(id)
          else current.add(id)
        }
        return { selection: [...current], edgeSelection: [] }
      })
    },
    selectEdge(id: string | null) {
      store.setState({ selection: [], edgeSelection: id ? [id] : [] })
    },
    setTool(tool: Tool) {
      store.setState({ tool })
    },
    setPreview(preview: Preview | null) {
      store.setState({ preview })
    },
    setEditing(id: string | null) {
      store.setState({ editing: id })
    },
    setStage(stage: Size) {
      store.setState({ stage })
    },
    openInspector(id: string | null) {
      store.setState({ inspector: id })
    },
    notify(notice: Notice | null) {
      store.setState({ notice })
    },
    addFiles(files: readonly ImageFile[]) {
      if (!files.length) return
      store.setState((state) => ({ files: { ...state.files, ...filesOf(files) } }))
    },
    addPlaceholders(items: readonly Placeholder[]) {
      store.setState((state) => ({ placeholders: [...state.placeholders, ...items] }))
    },
    removePlaceholders(ids: readonly string[]) {
      const removed = new Set(ids)
      store.setState((state) => ({
        placeholders: state.placeholders.filter((item) => !removed.has(item.id)),
      }))
    },
    /** Records the server's acknowledgement of a save without touching local edits. */
    adopt(saved: Canvas) {
      store.setState((state) => ({
        version: saved.version,
        files: { ...state.files, ...filesOf(saved.files) },
      }))
    },
    /** Replaces local state with the server copy (conflict resolution). */
    replace(latest: Canvas) {
      store.setState((state) => ({
        ...initial(latest),
        tool: state.tool,
        stage: state.stage,
        revision: state.revision + 1,
        viewRevision: state.viewRevision,
      }))
    },
  }
  return editor
}

export type CanvasEditor = ReturnType<typeof createCanvasEditor>
