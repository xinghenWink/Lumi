import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createDropRegistry, DropContext } from '../../features/files/drop'

const DropOverlay = lazy(() => import('./DropOverlay'))

/**
 * Owns window-level drag/paste handling for a shell. Dropping files anywhere never
 * navigates the browser away; the overlay is loaded only while a file is dragged.
 */
export function DropLayer({ children }: { children: ReactNode }) {
  const [registry] = useState(createDropRegistry)
  useEffect(() => registry.attach(window), [registry])
  const active = useStore(registry.store, (state) => state.depth > 0)
  const target = active ? registry.current() : undefined
  return (
    <DropContext.Provider value={registry}>
      {children}
      {target ? (
        <Suspense fallback={null}>
          <DropOverlay enabled={target.enabled} title={target.title} hint={target.hint} />
        </Suspense>
      ) : null}
    </DropContext.Provider>
  )
}
