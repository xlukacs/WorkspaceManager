import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Windows CLI wrapper', () => {
  const cmd = readFileSync(resolve('build/wsm.cmd'), 'utf8')
  const ps1 = readFileSync(resolve('build/wsm.ps1'), 'utf8')
  const installer = readFileSync(resolve('build/installer.nsh'), 'utf8')
  const builder = readFileSync(resolve('electron-builder.yml'), 'utf8')
  const smoke = readFileSync(resolve('scripts/smoke-windows-installer.ps1'), 'utf8')

  it('runs Electron as Node without attaching the GUI exe to the console', () => {
    expect(cmd).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(cmd).toContain('WorkspaceManager.exe')
    expect(cmd).toMatch(/>"%OUT%"/)
    expect(cmd).toMatch(/2>"%ERR%"/)
    expect(cmd).toContain('type "%OUT%"')
    expect(cmd).toContain('exit /b %CODE%')
  })

  it('gives PowerShell a script so Copilot ConPTY never calls ReadConsoleOutput on wsm.cmd', () => {
    expect(ps1).toContain('Start-Process')
    expect(ps1).toContain('ELECTRON_RUN_AS_NODE')
    expect(ps1).toContain('WindowStyle Hidden')
    expect(ps1).toContain('RedirectStandardOutput')
    expect(ps1).toContain('$global:LASTEXITCODE')
    expect(ps1).not.toMatch(/^\s*exit\b/m)
    expect(builder).toContain('from: build/wsm.ps1')
    expect(installer).toContain('bin\\wsm.ps1')
    expect(installer).toContain('bin\\workspace-manager.ps1')
    expect(smoke).toContain("Get-Command wsm")
    expect(smoke).toContain("CommandType -eq 'ExternalScript'")
    expect(smoke).toContain("PS5 wsm resolved to")
  })
})
