import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, type ReactNode, type RefObject } from 'react'

export default function VirtualHistoryRows({
  keys,
  scroller,
  renderRow,
}: {
  keys: readonly string[]
  scroller: RefObject<HTMLDivElement | null>
  renderRow(index: number): ReactNode
}) {
  'use no memo'
  const getKey = useCallback((index: number) => keys[index] ?? index, [keys])
  // eslint-disable-next-line react-hooks/incompatible-library -- Mutable getters stay inside this non-compiled boundary.
  const virtual = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 40,
    overscan: 3,
    getItemKey: getKey,
    useFlushSync: false,
  })
  return (
    <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
      {virtual.getVirtualItems().map((item) => (
        <div
          key={item.key}
          className="absolute top-0 left-0 w-full"
          style={{ transform: `translateY(${item.start}px)` }}
        >
          {renderRow(item.index)}
        </div>
      ))}
    </div>
  )
}
