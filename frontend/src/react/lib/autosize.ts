import { useLayoutEffect, type RefObject } from 'react'

/** Grows a textarea with its content up to `max` pixels, then scrolls. */
export function useAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  max: number,
) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = Math.min(element.scrollHeight, max) + 'px'
    element.style.overflowY = element.scrollHeight > max ? 'auto' : 'hidden'
  }, [ref, value, max])
}
