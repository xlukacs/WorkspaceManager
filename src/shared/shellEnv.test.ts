import { describe, expect, it } from 'vitest'
import {
  buildShellEnv,
  getCommandInvocation,
  shouldRunViaWindowsCmd,
  toChildProcessArgs,
  windowsCmdArgs
} from '@shared/shellEnv'

describe('windows cmd quoting', () => {
  it('keeps inner quotes for cmd /S so they are not part of the filename', () => {
    expect(windowsCmdArgs('docker compose -f "docker-compose.yaml" down')).toBe(
      '/d /s /c "docker compose -f "docker-compose.yaml" down"'
    )
  })

  it('runs docker through cmd even when PowerShell is preferred', () => {
    expect(shouldRunViaWindowsCmd('powershell', 'docker compose up')).toBe(true)
    expect(shouldRunViaWindowsCmd('powershell', 'docker.exe compose down')).toBe(true)
    expect(shouldRunViaWindowsCmd('powershell', 'docker-compose logs -f')).toBe(true)
    expect(shouldRunViaWindowsCmd('powershell', 'pnpm run dev')).toBe(false)
    expect(shouldRunViaWindowsCmd('cmd', 'pnpm run dev')).toBe(true)
  })

  it('passes the cmd command line as a single verbatim argument', () => {
    expect(toChildProcessArgs({
      shell: 'cmd.exe',
      args: windowsCmdArgs('docker compose -f "docker-compose.yaml" down'),
      windowsVerbatimArguments: true
    })).toEqual({
      args: ['/d /s /c "docker compose -f "docker-compose.yaml" down"'],
      windowsVerbatimArguments: true
    })
  })
})

describe('getCommandInvocation', () => {
  it.runIf(process.platform === 'win32')('runs docker through cmd.exe so PowerShell does not wrap docker.exe', () => {
    expect(getCommandInvocation('powershell', 'docker compose -f docker-compose.yaml down')).toEqual({
      shell: 'cmd.exe',
      args: '/d /s /c "docker compose -f docker-compose.yaml down"',
      windowsVerbatimArguments: true
    })
  })

  it.runIf(process.platform === 'win32')('keeps PowerShell for non-docker commands', () => {
    expect(getCommandInvocation('powershell', 'pnpm run dev')).toEqual({
      shell: 'powershell.exe',
      args: ['-NoLogo', '-Command', 'pnpm run dev']
    })
  })

  it.runIf(process.platform === 'win32')('uses a raw cmd command line for Command Prompt', () => {
    expect(getCommandInvocation('cmd', 'docker compose -f "docker-compose.yaml" down')).toEqual({
      shell: 'cmd.exe',
      args: '/d /s /c "docker compose -f "docker-compose.yaml" down"',
      windowsVerbatimArguments: true
    })
  })
})

describe('buildShellEnv', () => {
  it('does not force plain compose progress when ANSI is always', () => {
    const previous = process.env.COMPOSE_PROGRESS
    process.env.COMPOSE_PROGRESS = 'plain'
    try {
      const env = buildShellEnv(null, { interactive: true })
      expect(env.COMPOSE_ANSI).toBe('always')
      expect(env.COMPOSE_PROGRESS).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.COMPOSE_PROGRESS
      else process.env.COMPOSE_PROGRESS = previous
    }
  })

  it('uses plain compose progress for non-interactive Windows runs', () => {
    const env = buildShellEnv(null, { interactive: false })
    expect(env.COMPOSE_ANSI).toBe('never')
    if (process.platform === 'win32') expect(env.COMPOSE_PROGRESS).toBe('plain')
    else expect(env.COMPOSE_PROGRESS).toBeUndefined()
  })
})
