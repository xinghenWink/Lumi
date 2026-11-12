import { createContext, useContext, useEffect, useId, useLayoutEffect } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { carriesFiles, dragDepth, filesFrom } from './reference-rules'

export interface DropTarget {
  /** False shows the overlay in its unavailable state and ignores dropped files. */
  enabled: boolean
  title: string
  hint: string
  onFiles(files: File[]): void
}
interface DropState {
  depth: number
}

const editable = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/**
 * One registry per shell: window listeners live in a single place so nested
 * elements never race each other, and a file dropped anywhere in the workspace is
 * either routed to the active composer or swallowed instead of opening the file.
 * Targets are kept outside reactive state so typing in a composer never re-renders
 * the shell; only the drag depth is observable.
 */
export function createDropRegistry() {
  const store = createStore<DropState>(() => ({ depth: 0 }))
  let targets: { id: string; target: DropTarget }[] = []
  const current = () => targets.at(-1)?.target
  const modalOpen = () => !!document.querySelector('[data-lumi-modal]')
  const native = (event: Event) =>
    event.target instanceof HTMLInputElement && event.target.type === 'file'
  const reset = () => {
    if (store.getState().depth) store.setState({ depth: 0 })
  }
  function attach(view: Window) {
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer) || native(event)) return
      event.preventDefault()
      if (!modalOpen() && current())
        store.setState((state) => ({ depth: dragDepth(state.depth, 'enter') }))
    }
    const over = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer) || native(event)) return
      event.preventDefault()
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = current()?.enabled && !modalOpen() ? 'copy' : 'none'
    }
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return
      store.setState((state) => ({ depth: dragDepth(state.depth, 'leave') }))
    }
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer) || native(event)) return
      event.preventDefault()
      reset()
      const target = current()
      if (target?.enabled && !modalOpen()) target.onFiles(filesFrom(event.dataTransfer?.files))
    }
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || modalOpen()) return
      const files = filesFrom(event.clipboardData?.files)
      const target = current()
      if (!files.length || !target?.enabled) return
      // Pasting into another field keeps that field's own behavior.
      const active = document.activeElement
      if (active instanceof Element && active.matches(editable)) return
      event.preventDefault()
      target.onFiles(files)
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') reset()
    }
    view.addEventListener('dragenter', enter)
    view.addEventListener('dragover', over)
    view.addEventListener('dragleave', leave)
    view.addEventListener('drop', drop)
    view.addEventListener('dragend', reset)
    view.addEventListener('blur', reset)
    view.addEventListener('paste', paste)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      view.removeEventListener('dragenter', enter)
      view.removeEventListener('dragover', over)
      view.removeEventListener('dragleave', leave)
      view.removeEventListener('drop', drop)
      view.removeEventListener('dragend', reset)
      view.removeEventListener('blur', reset)
      view.removeEventListener('paste', paste)
      document.removeEventListener('visibilitychange', visibility)
      reset()
    }
  }
  function set(id: string, target: DropTarget) {
    const index = targets.findIndex((entry) => entry.id === id)
    if (index === -1) targets = [...targets, { id, target }]
    else targets = targets.map((entry, position) => (position === index ? { id, target } : entry))
  }
  function remove(id: string) {
    targets = targets.filter((entry) => entry.id !== id)
    if (!targets.length) reset()
  }
  return { store, attach, set, remove, current }
}
export type DropRegistry = ReturnType<typeof createDropRegistry>

export const DropContext = createContext<DropRegistry | null>(null)

const idle: StoreApi<DropState> = createStore<DropState>(() => ({ depth: 0 }))

/** Registers the page's drop and paste target; returns whether a file drag is in progress. */
export function useFileDrop(target: DropTarget) {
  const registry = useContext(DropContext)
  const id = useId()
  useLayoutEffect(() => {
    registry?.set(id, target)
  })
  useEffect(() => {
    if (!registry) return
    return () => registry.remove(id)
  }, [registry, id])
  return useStore(registry?.store ?? idle, (state) => state.depth > 0)
}
