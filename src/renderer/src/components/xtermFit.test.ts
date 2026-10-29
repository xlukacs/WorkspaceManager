import { describe, expect, it, vi } from 'vitest'
import { fitXtermSafely, isXtermRenderable } from '@renderer/components/xtermFit'

function terminal(options: { connected?: boolean; parent?: boolean } = {}) {
  const connected = options.connected !== false
  const parent = options.parent === false ? null : {}
  return { element: { isConnected: connected, parentElement: parent } }
}

describe('fitXtermSafely', () => {
  it('does not fit when the terminal is missing, detached, or has no parent', () => {
    const fit = vi.fn()
    expect(fitXtermSafely({ fit }, null)).toBe(false)
    expect(fitXtermSafely(null, terminal())).toBe(false)
    expect(fitXtermSafely({ fit }, { element: null })).toBe(false)
    expect(fitXtermSafely({ fit }, terminal({ connected: false }))).toBe(false)
    expect(fitXtermSafely({ fit }, terminal({ parent: false }))).toBe(false)
    expect(fit).not.toHaveBeenCalled()
  })

  it('fits a live terminal and swallows FitAddon dimension crashes', () => {
    const fit = vi.fn()
    expect(isXtermRenderable(terminal())).toBe(true)
    expect(fitXtermSafely({ fit }, terminal())).toBe(true)
    expect(fit).toHaveBeenCalledOnce()

    const crashing = vi.fn(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'dimensions')")
    })
    expect(fitXtermSafely({ fit: crashing }, terminal())).toBe(false)
    expect(crashing).toHaveBeenCalledOnce()
  })
})
