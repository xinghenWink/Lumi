import { createContext } from 'react'

export const AnnouncementsContext = createContext<{
  open(): void
  setTrigger(trigger: HTMLButtonElement | null): void
} | null>(null)
