import { describe, expect, it, vi } from 'vitest'
import { killChildProcess, killProcessTree, killPtyProcess } from '@main/services/processTree'

describe('processTree', () => {
  it('kills a pty process tree when pid is available', () => {
    const kill = vi.fn()
    killPtyProcess({ pid: 4242, kill })
    expect(kill).toHaveBeenCalledOnce()
  })

  it('kills a child process tree when pid is available', () => {
    const child = {
      killed: false,
      pid: 5150,
      kill: vi.fn()
    }
    killChildProcess(child as never)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('ignores invalid pids', () => {
    expect(() => killProcessTree(undefined)).not.toThrow()
    expect(() => killProcessTree(0)).not.toThrow()
    expect(() => killProcessTree(-1)).not.toThrow()
  })
})
