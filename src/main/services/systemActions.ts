import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { shell } from 'electron'
import type { EditorTarget, ExternalTerminalPreference, OpenTarget } from '@shared/types'

async function launchEditor(command: string, targetPath: string) {
  return await new Promise<boolean>((resolve) => {
    const child = platform() === 'win32'
      ? spawn('cmd.exe', ['/c', command, '-n', targetPath], {
          detached: true,
          stdio: 'ignore'
        })
      : spawn(command, ['-n', targetPath], {
          detached: true,
          stdio: 'ignore'
        })

    const handleSpawn = () => {
      child.unref()
      resolve(true)
    }

    const handleError = () => {
      resolve(false)
    }

    child.once('spawn', handleSpawn)
    child.once('error', handleError)
  })
}

export async function openInEditor(targetPath: string, editor: EditorTarget = 'cursor') {
  const command = editor === 'cursor' ? 'cursor' : 'code'
  const opened = await launchEditor(command, targetPath)
  if (!opened) {
    await openPath(targetPath)
  }
}

export async function openPath(targetPath: string) {
  const error = await shell.openPath(targetPath)
  if (error) throw new Error(error)
}

async function launchDetached(command: string, args: readonly string[], cwd?: string) {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore'
    })

    const handleSpawn = () => {
      child.unref()
      resolve(true)
    }

    const handleError = () => {
      resolve(false)
    }

    child.once('spawn', handleSpawn)
    child.once('error', handleError)
  })
}

export async function openInTerminal(targetPath: string, preference: ExternalTerminalPreference = 'auto') {
  const preferred = preferredTerminalInvocation(preference, targetPath, platform())
  if (preferred && await launchDetached(preferred.command, preferred.args, targetPath)) return
  if (platform() === 'win32') {
    const openedWindowsTerminal = await launchDetached('wt.exe', ['-d', targetPath], targetPath)
    if (openedWindowsTerminal) return

    const openedCmd = await launchDetached('cmd.exe', ['/k'], targetPath)
    if (openedCmd) return
  }

  if (platform() === 'linux') {
    const linuxTerminals = [
      ['x-terminal-emulator', ['--working-directory', targetPath]],
      ['gnome-terminal', [`--working-directory=${targetPath}`]],
      ['konsole', ['--workdir', targetPath]],
      ['xfce4-terminal', ['--working-directory', targetPath]],
      ['kitty', ['--directory', targetPath]],
      ['alacritty', ['--working-directory', targetPath]],
      ['wezterm', ['start', '--cwd', targetPath]]
    ] as const

    for (const [command, args] of linuxTerminals) {
      if (await launchDetached(command, args, targetPath)) return
    }
  }

  if (platform() === 'darwin' && await launchDetached('open', ['-a', 'Terminal', targetPath], targetPath)) {
    return
  }

  throw new Error(`Unable to open a terminal for ${targetPath}.`)
}

export function preferredTerminalInvocation(preference: ExternalTerminalPreference, targetPath: string, os: string) {
  const windows = {
    'windows-terminal': { command: 'wt.exe', args: ['-d', targetPath] },
    powershell: { command: 'powershell.exe', args: ['-NoExit', '-Command', `Set-Location -LiteralPath '${targetPath.replaceAll("'", "''")}'`] },
    cmd: { command: 'cmd.exe', args: ['/k'] }
  }
  if (os === 'win32') return windows[preference as keyof typeof windows] ?? null
  const linux = {
    'x-terminal-emulator': ['--working-directory', targetPath],
    'gnome-terminal': [`--working-directory=${targetPath}`], konsole: ['--workdir', targetPath],
    'xfce4-terminal': ['--working-directory', targetPath], kitty: ['--directory', targetPath],
    alacritty: ['--working-directory', targetPath], wezterm: ['start', '--cwd', targetPath]
  }
  if (os === 'linux' && preference in linux) return { command: preference, args: linux[preference as keyof typeof linux] }
  if (os === 'darwin' && (preference === 'terminal' || preference === 'iterm')) return { command: 'open', args: ['-a', preference === 'terminal' ? 'Terminal' : 'iTerm', targetPath] }
  return null
}

export async function openWorkspaceTarget(targetPath: string, target: OpenTarget, terminal: ExternalTerminalPreference) {
  if (target === 'folder') return openPath(targetPath)
  if (target === 'terminal') return openInTerminal(targetPath, terminal)
  return openInEditor(targetPath, target)
}

export async function openExternal(targetPath: string) {
  await shell.openExternal(targetPath)
}
