import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDropRegistry } from './drop'

function fileEvent(type: 'drop' | 'paste', files: File[], point = { x: 0, y: 0 }) {
  const event = new Event(type, { cancelable: true, bubbles: true })
  const transfer = { types: ['Files'], files, getData: () => '' }
  return Object.assign(event, {
    clientX: point.x,
    clientY: point.y,
    dataTransfer: transfer,
    clipboardData: transfer,
  })
}

describe('drop registry', () => {
  let detach = () => {}
  afterEach(() => detach())

  it('passes the drop point to the newest target and omits it for pastes', () => {
    const registry = createDropRegistry()
    detach = registry.attach(window)
    const older = vi.fn()
    const newer = vi.fn()
    registry.set('a', { enabled: true, title: '', hint: '', onFiles: older })
    registry.set('b', { enabled: true, title: '', hint: '', onFiles: newer })
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    const drop = fileEvent('drop', [file], { x: 12, y: 34 })
    window.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    expect(newer).toHaveBeenLastCalledWith([file], { x: 12, y: 34 })

    window.dispatchEvent(fileEvent('paste', [file]))
    expect(newer).toHaveBeenLastCalledWith([file])
    expect(older).not.toHaveBeenCalled()
  })
})
