import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Windows CLI wrapper', () => {
  const cmd = readFileSync(resolve('build/wsm.cmd'), 'utf8')

  it('runs Electron as Node without attaching the GUI exe to the console', () => {
    expect(cmd).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(cmd).toContain('WorkspaceManager.exe')
    expect(cmd).toMatch(/>"%OUT%"/)
    expect(cmd).toMatch(/2>"%ERR%"/)
    expect(cmd).toContain('type "%OUT%"')
    expect(cmd).toContain('exit /b %CODE%')
  })
})
