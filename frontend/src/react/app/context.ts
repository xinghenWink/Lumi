import { createContext, useContext } from 'react'
import type { AppRuntime } from './runtime'

export const RuntimeContext = createContext<AppRuntime | null>(null)
export function useRuntime() {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('App runtime provider is missing')
  return runtime
}
