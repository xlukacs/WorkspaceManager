import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { platform } from 'node:os'

export type KillablePty = {
  pid?: number
  kill: () => void
}

function killWindowsTree(pid: number, sync: boolean) {
  const command = `taskkill /PID ${pid} /T /F`
  if (sync) {
    try {
      execSync(command, { stdio: 'ignore', windowsHide: true })
    } catch {
      // Process may already be gone.
    }
    return
  }

  spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

function killUnixTree(pid: number, sync: boolean) {
  const signal: NodeJS.Signals = sync ? 'SIGKILL' : 'SIGTERM'
  try {
    process.kill(-pid, signal)
    return
  } catch {
    // Fall through to direct pid.
  }

  try {
    process.kill(pid, signal)
  } catch {
    // Process may already be gone.
  }
}

export function killProcessTree(pid: number | undefined, options?: { sync?: boolean }) {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return

  if (platform() === 'win32') {
    killWindowsTree(pid, options?.sync ?? false)
    return
  }

  killUnixTree(pid, options?.sync ?? false)
}

export function killChildProcess(child: ChildProcess, options?: { sync?: boolean }) {
  if (child.killed) return
  const pid = child.pid
  if (pid === undefined) return
  killProcessTree(pid, options)
}

/** How long a Windows stop waits for taskkill before it closes the PTY anyway. */
export const WINDOWS_PTY_CLOSE_TIMEOUT_MS = 3_000

function closePty(pty: KillablePty) {
  try {
    pty.kill()
  } catch {
    // PTY may already be closed.
  }
}

/**
 * Kill the tree first, then close the PTY. On Windows, node-pty's kill() calls
 * ClosePseudoConsole on the main thread. Before Windows 11 24H2 that call
 * blocks until every attached process has exited, so a dev server that
 * shuts down gracefully freezes the whole app. Once the tree is gone,
 * node-pty has released the console and kill() returns at once.
 */
function killWindowsPtyTree(pty: KillablePty) {
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    closePty(pty)
  }
  const timer = setTimeout(close, WINDOWS_PTY_CLOSE_TIMEOUT_MS)
  const pid = pty.pid
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    close()
    return
  }

  try {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.once('exit', close)
    killer.once('error', close)
  } catch {
    close()
  }
}

export function killPtyProcess(pty: KillablePty, options?: { sync?: boolean }) {
  if (platform() === 'win32' && !options?.sync) {
    killWindowsPtyTree(pty)
    return
  }

  // On quit, close the PTY first so Windows ConPTY can AttachConsole while the
  // host is still alive. taskkill /T /F beforehand tears that console down and
  // leaves node-pty worker handles that keep Electron from exiting.
  closePty(pty)
  killProcessTree(pty.pid, options)
}
