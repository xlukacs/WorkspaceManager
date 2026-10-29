import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

describe('CLI process entry', () => {
  let root: string
  let bundle: string
  let storePath: string
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'wsm-cli-entry-'))
    bundle = join(root, 'index.js')
    storePath = join(root, 'empty store.json')
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(storePath, JSON.stringify({ version: 14, groups: [], workspaces: [], terminals: [], settings: {} }))
    await build({
      configFile: resolve('vite.cli.config.ts'),
      logLevel: 'silent',
      build: { outDir: root, emptyOutDir: false, sourcemap: false }
    })
  }, 30_000)
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it.each(['/usr/bin/node', 'C:\\Program Files\\Workspace Manager\\WorkspaceManager.exe'])(
    'lists an empty catalog when launched by %s', (executable) => {
      // The real entry flushes its output and exits. Keep that lifecycle inside
      // a child so it cannot terminate or leak exit callbacks into a test worker.
      const argv = [executable, bundle, 'list', '--store', storePath, '--json']
      const source = `process.argv = ${JSON.stringify(argv)}; await import(${JSON.stringify(pathToFileURL(bundle).href)})`
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        encoding: 'utf8', timeout: 10_000
      })
      expect(result.error).toBeUndefined()
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('[]\n')
    }
  )
})
