import { useEffect, useLayoutEffect, useState } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { QueryClient } from '@tanstack/react-query'
import type { ImageFile } from '../../../api/images'
import { useRuntime } from '../../app/context'
import type { AppRuntime } from '../../app/runtime'
import { screenFiles, type Rejections } from './reference-rules'

export interface UploadItem {
  key: string
  file: File
  /** Local object URL shown immediately, before the server round-trip completes. */
  url: string
  status: 'queued' | 'uploading' | 'error' | 'done'
  fileId?: string | undefined
  uploaded?: ImageFile | undefined
  /** Set once the draft accepted the reference; only then may a missing ID release the preview. */
  committed?: boolean
  error?: unknown
}
export interface UploadOptions {
  /** Reference IDs already committed to the draft. */
  ids: readonly string[]
  limit: number
  maxBytes?: number | undefined
  enabled: boolean
  /** Adds an uploaded file to the draft; throws when the draft can no longer accept it. */
  commit(file: ImageFile): void
}
interface UploadState {
  items: UploadItem[]
  notice: Rejections | null
}
type Session = AppRuntime['session']
type Upload = (file: File, signal: AbortSignal) => Promise<ImageFile>

const concurrency = 2

/**
 * Upload queue for one composer. Uploads are deliberately not aborted on unmount:
 * a finished upload still commits to the draft store, so switching modes mid-upload
 * never loses an image. They stop only on explicit cancel or an identity change.
 */
export function createReferenceUploads(session: Session, client: QueryClient, upload: Upload) {
  const store = createStore<UploadState>(() => ({ items: [], notice: null }))
  const controllers = new Map<string, AbortController>()
  let options: UploadOptions = { ids: [], limit: 0, enabled: false, commit: () => undefined }
  let owner = session.getSnapshot().user?.id,
    epoch = session.snapshot().epoch
  let mounted = false,
    revoked = false,
    sequence = 0,
    noticeTimer: ReturnType<typeof setTimeout> | undefined,
    unsubscribe: (() => void) | undefined

  const items = () => store.getState().items
  const patch = (key: string, value: Partial<UploadItem>) =>
    store.setState((state) => ({
      items: state.items.map((item) => (item.key === key ? { ...item, ...value } : item)),
    }))
  const drop = (key: string) => {
    const item = items().find((entry) => entry.key === key)
    controllers.get(key)?.abort()
    controllers.delete(key)
    if (item && !revoked) URL.revokeObjectURL(item.url)
    store.setState((state) => ({ items: state.items.filter((entry) => entry.key !== key) }))
  }
  const live = () =>
    owner === session.getSnapshot().user?.id && epoch === session.snapshot().epoch && !!owner
  const pending = () => items().filter((item) => item.status !== 'done')

  function reset() {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    if (!revoked) for (const item of items()) URL.revokeObjectURL(item.url)
    store.setState({ items: [], notice: null })
  }
  function watch() {
    unsubscribe ??= session.subscribe(() => {
      const next = session.getSnapshot()
      if (next.user?.id !== owner || session.snapshot().epoch !== epoch) {
        reset()
        owner = next.user?.id
        epoch = session.snapshot().epoch
      }
    })
  }
  function settle() {
    if (!mounted && !controllers.size) {
      unsubscribe?.()
      unsubscribe = undefined
    }
  }
  function finish(item: UploadItem, file: ImageFile) {
    client.setQueryData(['user', owner, 'file', file.id], file)
    // Mark done before committing so the tray never renders the local and committed chip together.
    patch(item.key, { status: 'done', fileId: file.id, uploaded: file, error: undefined })
    try {
      options.commit(file)
      patch(item.key, { committed: true })
    } catch (failure) {
      patch(item.key, { status: 'error', fileId: undefined, error: failure })
    }
  }
  function pump() {
    while (controllers.size < concurrency) {
      const next = items().find((item) => item.status === 'queued')
      if (!next) break
      const controller = new AbortController()
      controllers.set(next.key, controller)
      patch(next.key, { status: 'uploading', error: undefined })
      void upload(next.file, controller.signal)
        .then((file) => {
          if (!controller.signal.aborted && live()) finish(next, file)
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted && live())
            patch(next.key, { status: 'error', error: failure })
        })
        .finally(() => {
          if (controllers.get(next.key) === controller) controllers.delete(next.key)
          pump()
          settle()
        })
    }
  }
  function showNotice(rejected: Rejections) {
    clearTimeout(noticeTimer)
    if (!rejected.type && !rejected.size && !rejected.limit) {
      store.setState({ notice: null })
      return
    }
    store.setState({ notice: rejected })
    noticeTimer = setTimeout(() => store.setState({ notice: null }), 6000)
  }

  return {
    store,
    configure(next: UploadOptions) {
      options = next
    },
    /** Number of slots taken by committed references and unfinished uploads. */
    used: () => options.ids.length + pending().length,
    add(files: Iterable<File>) {
      if (!options.enabled || !live()) return 0
      const { accepted, rejected } = screenFiles(
        files,
        options.limit - options.ids.length - pending().length,
        options.maxBytes,
      )
      showNotice(rejected)
      if (!accepted.length) return 0
      watch()
      const added = accepted.map((file) => ({
        key: 'upload-' + ++sequence,
        file,
        url: URL.createObjectURL(file),
        status: 'queued' as const,
      }))
      store.setState((state) => ({ items: [...state.items, ...added] }))
      pump()
      return accepted.length
    },
    retry(key: string) {
      const item = items().find((entry) => entry.key === key)
      if (!item || item.status !== 'error' || !live()) return
      if (item.uploaded) finish(item, item.uploaded)
      else {
        patch(key, { status: 'queued', error: undefined })
        pump()
      }
    },
    cancel: drop,
    dismiss() {
      clearTimeout(noticeTimer)
      store.setState({ notice: null })
    },
    /** Releases previews whose references were removed or sent. */
    sync(ids: readonly string[]) {
      for (const item of items())
        if (item.committed && item.fileId && !ids.includes(item.fileId)) drop(item.key)
    },
    mount() {
      mounted = true
      if (revoked) {
        // React StrictMode replays mount effects; restore previews released by the replayed cleanup.
        revoked = false
        store.setState((state) => ({
          items: state.items.map((item) => ({ ...item, url: URL.createObjectURL(item.file) })),
        }))
      }
      if (items().length) watch()
      return () => {
        mounted = false
        revoked = true
        clearTimeout(noticeTimer)
        for (const item of items()) URL.revokeObjectURL(item.url)
        settle()
      }
    },
  }
}
export type ReferenceUploads = ReturnType<typeof createReferenceUploads>

export function useReferenceUploads(options: UploadOptions) {
  const runtime = useRuntime()
  const [uploads] = useState(() =>
    createReferenceUploads(runtime.session, runtime.queryClient, async (file, signal) => {
      const { images } = await import('../../../api/images')
      return images.upload(file, signal)
    }),
  )
  useLayoutEffect(() => {
    uploads.configure(options)
  })
  useEffect(() => uploads.mount(), [uploads])
  useLayoutEffect(() => {
    uploads.sync(options.ids)
  }, [uploads, options.ids])
  const state = useStore(uploads.store)
  const items = state.items.filter((item) => item.status !== 'done')
  const previews = new Map<string, string>()
  for (const item of state.items) if (item.fileId) previews.set(item.fileId, item.url)
  return {
    uploads,
    items,
    previews,
    notice: state.notice,
    used: options.ids.length + items.length,
    busy: items.some((item) => item.status === 'queued' || item.status === 'uploading'),
  }
}
