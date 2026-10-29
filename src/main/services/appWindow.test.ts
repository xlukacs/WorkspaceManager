import { describe, expect, it, vi } from 'vitest'
import { manageAppWindow } from './appWindow'
describe('desktop window lifecycle', () => {
  it('reuses live windows and reattaches a replacement before focusing after close', () => {
    let closed = false
    const first = { isDestroyed: () => closed, isMinimized: () => false, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
    const second = { ...first, isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
    const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const attached = vi.fn()
    const windows = manageAppWindow(create, attached)
    expect(windows.get()).toBe(first)
    expect(windows.get()).toBe(first)
    closed = true
    windows.focus()
    expect(create).toHaveBeenCalledTimes(2)
    expect(attached).toHaveBeenLastCalledWith(second)
    expect(first.focus).not.toHaveBeenCalled()
    expect(second.restore).toHaveBeenCalledOnce()
    expect(second.show).toHaveBeenCalledOnce()
    expect(second.focus).toHaveBeenCalledOnce()
  })
})
