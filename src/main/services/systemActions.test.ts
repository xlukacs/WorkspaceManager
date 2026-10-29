import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ os: 'linux', failures: new Set<string>(), calls: [] as Array<{ command: string; args: string[]; cwd?: string }> }))
const shell = vi.hoisted(() => ({ openPath: vi.fn(async () => ''), openExternal: vi.fn(async () => {}) }))
vi.mock('electron', () => ({ shell }))
vi.mock('node:os', () => ({ platform: () => state.os }))
vi.mock('node:child_process', () => ({ spawn: (command: string, args: string[], options: { cwd?: string }) => {
  state.calls.push({ command, args, cwd: options.cwd })
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  queueMicrotask(() => child.emit(state.failures.has(command) ? 'error' : 'spawn'))
  return child
} }))
import { openInTerminal, openWorkspaceTarget, openPath } from './systemActions'
afterEach(() => { state.os = 'linux'; state.failures.clear(); state.calls = []; vi.clearAllMocks() })
describe('preferred Open actions', () => {
  it('tries the selected Linux terminal and falls back to automatic detection', async () => {
    state.failures.add('kitty')
    await openInTerminal('/checkout with spaces', 'kitty')
    expect(state.calls.map((entry) => entry.command)).toEqual(['kitty', 'x-terminal-emulator'])
    expect(state.calls.every((entry) => entry.cwd === '/checkout with spaces')).toBe(true)
  })
  it('supports PowerShell on Windows and iTerm on macOS', async () => {
    state.os = 'win32'
    await openInTerminal("C:\\repo's checkout", 'powershell')
    expect(state.calls[0]).toMatchObject({ command: 'powershell.exe', args: ['-NoExit', '-Command', "Set-Location -LiteralPath 'C:\\repo''s checkout'"] })
    state.os = 'darwin'
    await openInTerminal('/feature', 'iterm')
    expect(state.calls[1]).toMatchObject({ command: 'open', args: ['-a', 'iTerm', '/feature'] })
  })
  it('opens the supplied selected checkout in the requested target', async () => {
    await openWorkspaceTarget('/feature checkout', 'folder', 'auto')
    expect(shell.openPath).toHaveBeenCalledWith('/feature checkout')
    await openWorkspaceTarget('/feature checkout', 'vscode', 'auto')
    expect(state.calls[0]).toMatchObject({ command: 'code', args: ['-n', '/feature checkout'] })
  })
  it('surfaces file-manager errors instead of reporting success', async () => {
    shell.openPath.mockResolvedValueOnce('Path not found')
    await expect(openPath('/gone')).rejects.toThrow('Path not found')
  })
})
