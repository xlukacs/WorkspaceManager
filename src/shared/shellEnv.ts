import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { delimiter, join } from 'node:path'
import type { PythonEnvironment, ShellPreference } from '@shared/types'

export type CommandInvocation = {
  shell: string
  args: string[] | string
  windowsVerbatimArguments?: boolean
}

const WINDOWS_CMD_NATIVE = /^(?:docker(?:-compose)?(?:\.exe)?)\b/i

export function windowsCmdArgs(shellLine: string) {
  return `/d /s /c "${shellLine}"`
}

export function shouldRunViaWindowsCmd(preferredShell: ShellPreference, shellLine: string) {
  return preferredShell === 'cmd' || WINDOWS_CMD_NATIVE.test(shellLine.trimStart())
}

export function toChildProcessArgs(invocation: CommandInvocation) {
  if (typeof invocation.args === 'string') {
    return { args: [invocation.args], windowsVerbatimArguments: invocation.windowsVerbatimArguments ?? true }
  }
  return { args: invocation.args, windowsVerbatimArguments: invocation.windowsVerbatimArguments }
}

export function commandExists(command: string) {
  if (command.includes('/') || command.includes('\\')) return existsSync(command)
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .some((entry) => existsSync(join(entry, command)))
}

export function getCommandInvocation(preferredShell: ShellPreference, shellLine: string): CommandInvocation {
  const currentPlatform = platform()
  if (currentPlatform === 'win32') {
    if (shouldRunViaWindowsCmd(preferredShell, shellLine)) {
      // node-pty/Node re-escape argv quotes; cmd /S needs the raw command line so -f "file" is not a filename.
      return { shell: 'cmd.exe', args: windowsCmdArgs(shellLine), windowsVerbatimArguments: true }
    }
    return { shell: 'powershell.exe', args: ['-NoLogo', '-Command', shellLine] }
  }

  if (preferredShell === 'powershell' && commandExists('pwsh')) {
    return { shell: 'pwsh', args: ['-NoLogo', '-Command', shellLine] }
  }
  if (existsSync('/bin/bash')) return { shell: '/bin/bash', args: ['-lc', shellLine] }
  return { shell: '/bin/sh', args: ['-lc', shellLine] }
}

function compareVersionDirectories(left: string, right: string) {
  const leftParts = left.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0)

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (difference !== 0) return difference
  }

  return right.localeCompare(left)
}

function getNvmPathEntries(homePath: string) {
  const nodeVersionsPath = join(homePath, '.nvm', 'versions', 'node')
  if (!existsSync(nodeVersionsPath)) return []

  try {
    return readdirSync(nodeVersionsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionDirectories)
      .map((version) => join(nodeVersionsPath, version, 'bin'))
      .filter((entry) => existsSync(entry))
  } catch {
    return []
  }
}

function getUserPathEntries() {
  const homePath = homedir()
  if (!homePath) return []

  return [
    ...getNvmPathEntries(homePath),
    join(homePath, '.local', 'share', 'pnpm'),
    join(homePath, '.volta', 'bin'),
    join(homePath, '.bun', 'bin'),
    join(homePath, '.yarn', 'bin'),
    join(homePath, '.npm-global', 'bin'),
    join(homePath, '.cargo', 'bin'),
    join(homePath, '.local', 'go', 'bin'),
    join(homePath, 'go', 'bin'),
    '/usr/local/go/bin'
  ].filter((entry) => existsSync(entry))
}

export function augmentPath(existingPath: string) {
  const entries = existingPath.split(delimiter).filter(Boolean)
  const seen = new Set(entries)

  for (const entry of getUserPathEntries()) {
    if (seen.has(entry)) continue
    entries.push(entry)
    seen.add(entry)
  }

  return entries.join(delimiter)
}

export function buildShellEnv(
  pythonEnvironment: PythonEnvironment | null,
  options?: { interactive?: boolean; nodeCaCertificate?: string | null }
) {
  const interactive = options?.interactive ?? false
  const env = { ...process.env } as NodeJS.ProcessEnv
  if (options?.nodeCaCertificate) env.NODE_EXTRA_CA_CERTS = options.nodeCaCertificate
  env.FORCE_COLOR = env.FORCE_COLOR ?? '1'
  env.CLICOLOR = env.CLICOLOR ?? '1'
  env.CLICOLOR_FORCE = env.CLICOLOR_FORCE ?? '1'
  env.PY_COLORS = env.PY_COLORS ?? '1'

  if (interactive) {
    env.COLORTERM = env.COLORTERM ?? 'truecolor'
    env.TERM = env.TERM ?? 'xterm-256color'
    env.COMPOSE_ANSI = env.COMPOSE_ANSI ?? 'always'
    // Compose rejects --progress=plain when ANSI is forced.
    if (env.COMPOSE_ANSI === 'always') delete env.COMPOSE_PROGRESS
  } else {
    env.BUILDKIT_PROGRESS = env.BUILDKIT_PROGRESS ?? 'plain'
    env.COMPOSE_ANSI = env.COMPOSE_ANSI ?? 'never'
    delete env.COLORTERM
    if (platform() === 'win32') env.COMPOSE_PROGRESS = env.COMPOSE_PROGRESS ?? 'plain'
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const existingPath = augmentPath(env[pathKey] ?? env.PATH ?? '')
  env[pathKey] = existingPath
  env.PATH = existingPath

  if (!pythonEnvironment) return env

  env.VIRTUAL_ENV = pythonEnvironment.rootPath
  env[pathKey] = [pythonEnvironment.scriptsPath, existingPath].filter(Boolean).join(delimiter)
  env.PATH = env[pathKey]
  if (env.PYTHONHOME) delete env.PYTHONHOME
  return env
}
