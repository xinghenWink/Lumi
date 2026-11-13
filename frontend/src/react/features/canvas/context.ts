import { createContext, useContext, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { ImageFile } from '../../../api/images'
import type { Autosave } from './autosave'
import type { BlobCache } from './blob-cache'
import type { CanvasEditor, EditorState } from './editor'
import type { CanvasGeneration } from './generation'
import type { createCanvasUploads } from './uploads'

export interface CanvasServices {
  editor: CanvasEditor
  autosave: Autosave
  generation: CanvasGeneration
  uploads: ReturnType<typeof createCanvasUploads>
  blobs: BlobCache
}

export const CanvasContext = createContext<CanvasServices | null>(null)

export function useCanvas() {
  const services = useContext(CanvasContext)
  if (!services) throw new Error('Canvas services are missing')
  return services
}

export function useEditor<T>(selector: (state: EditorState) => T) {
  return useStore(useCanvas().editor.store, selector)
}

/** Object URL for a file variant, shared through the canvas blob cache. */
export function useCanvasImage(file: ImageFile | undefined, variant: 'thumb' | 'original') {
  const { blobs } = useCanvas()
  const key = file ? file.id + ':' + variant : ''
  const [result, setResult] = useState<{ key: string; url?: string; failed?: boolean } | null>(null)
  useEffect(() => {
    if (!file) return
    let active = true
    blobs.acquire(file, variant).then(
      (url) => {
        if (active) setResult({ key, url })
      },
      () => {
        if (active) setResult({ key, failed: true })
      },
    )
    return () => {
      active = false
      blobs.release(file, variant)
    }
  }, [blobs, file, variant, key])
  return result?.key === key ? result : null
}
