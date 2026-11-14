import { useSyncExternalStore } from 'react'

// One shared one-second clock for every live elapsed-time label on the page.
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let now = Date.now()

function subscribe(listener: () => void) {
  if (!listeners.size) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const notify of listeners) notify()
    }, 1000)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
}
const idle = () => () => undefined
const snapshot = () => now

/** Current time in milliseconds, re-rendering every second only while `active`. */
export function useNow(active: boolean) {
  return useSyncExternalStore(active ? subscribe : idle, snapshot, snapshot)
}
