import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebounced, createRafBatch } from '@shared/debounce'

describe('createRafBatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flushes coalesced items on the next animation frame', () => {
    let frame = 0
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      frame += 1
      return frame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      if (id === frame) callbacks.pop()
    })

    const flush = vi.fn()
    const push = createRafBatch<string>(flush)

    push('a')
    push('b')
    expect(flush).not.toHaveBeenCalled()

    callbacks[0]?.(0)
    expect(flush).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledWith(['a', 'b'])
  })
})

describe('createDebounced', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs once after the wait, not on every call', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = createDebounced(fn, 250)

    debounced()
    debounced()
    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(249)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('flush runs a pending callback immediately', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = createDebounced(fn, 250)

    debounced()
    debounced.flush()
    expect(fn).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('cancel drops a pending callback', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = createDebounced(fn, 250)

    debounced()
    debounced.cancel()
    vi.advanceTimersByTime(250)
    expect(fn).not.toHaveBeenCalled()
  })
})
