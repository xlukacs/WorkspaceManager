import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => [] as Array<{ command: string; args: string[]; process: EventEmitter }>)

vi.mock('node:os', async (load) => ({ ...await load<typeof import('node:os')>(), platform: () => 'win32' }))
vi.mock('node:child_process', async (load) => ({
  ...await load<typeof import('node:child_process')>(),
  spawn: (command: string, args: string[]) => {
    const process = new EventEmitter()
    spawned.push({ command, args, process })
    return process
  }
}))

const { closePendingPtys, killPtyProcess, WINDOWS_PTY_CLOSE_TIMEOUT_MS } = await import('@main/services/processTree')

describe('killPtyProcess on Windows', () => {
  beforeEach(() => {
    spawned.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('kills the tree before closing the PTY so ClosePseudoConsole cannot block', () => {
    const kill = vi.fn()
    killPtyProcess({ pid: 4242, kill })

    expect(spawned.map(({ command, args }) => [command, ...args])).toEqual([['taskkill', '/PID', '4242', '/T', '/F']])
    expect(kill).not.toHaveBeenCalled()

    spawned[0].process.emit('exit', 0)
    expect(kill).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(WINDOWS_PTY_CLOSE_TIMEOUT_MS)
    expect(kill).toHaveBeenCalledOnce()
  })

  it('closes the PTY anyway when taskkill never finishes', () => {
    const kill = vi.fn()
    killPtyProcess({ pid: 4242, kill })
    vi.advanceTimersByTime(WINDOWS_PTY_CLOSE_TIMEOUT_MS)
    expect(kill).toHaveBeenCalledOnce()
  })

  it('closes PTYs still waiting on taskkill when the app quits', () => {
    const kill = vi.fn()
    killPtyProcess({ pid: 4242, kill })
    closePendingPtys()
    expect(kill).toHaveBeenCalledOnce()

    spawned[0].process.emit('exit', 0)
    vi.advanceTimersByTime(WINDOWS_PTY_CLOSE_TIMEOUT_MS)
    expect(kill).toHaveBeenCalledOnce()
  })

  it('closes the PTY first on quit so the app can exit', () => {
    const kill = vi.fn()
    killPtyProcess({ pid: 4242, kill }, { sync: true })
    expect(kill).toHaveBeenCalledOnce()
    expect(spawned).toHaveLength(0)
  })
})
