import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('app-builder-lib Windows rcedit patch', () => {
  const patch = readFileSync(resolve('patches/app-builder-lib@26.8.1.patch'), 'utf8')

  it('runs rcedit.exe from the zip toolset on Windows instead of app-builder rcedit', () => {
    expect(patch).toContain('if (process.platform === "win32") {')
    expect(patch).toContain('getRceditBundle')
    expect(patch).toContain('(0, builder_util_1.exec)(rcedit, args)')
    expect(patch).toContain('else if (process.platform === "darwin") {')
    expect(patch).toContain('-        if (process.platform === "win32" || process.platform === "darwin") {')
  })
})
