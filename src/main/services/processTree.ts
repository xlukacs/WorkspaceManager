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

export function killPtyProcess(pty: KillablePty, options?: { sync?: boolean }) {
  // Close the PTY first so Windows ConPTY can AttachConsole while the host is
  // still alive. taskkill /T /F beforehand tears that console down and leaves
  // node-pty worker handles that keep Electron from exiting.
  try {
    pty.kill()
  } catch {
    // PTY may already be closed.
  }
  killProcessTree(pty.pid, options)
}
