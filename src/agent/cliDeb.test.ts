import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_DEB_PACKAGE, debianControl, systemdUserUnit, writeDebianTree } from '../../scripts/cli-deb-layout.mjs'

describe('CLI Debian package layout', () => {
  it('describes an upgradable nodejs-dependent package', () => {
    const control = debianControl({ version: '0.1.0', installedSizeKb: 80 })
    expect(control).toContain(`Package: ${CLI_DEB_PACKAGE}`)
    expect(control).toContain('Depends: nodejs (>= 18)')
    expect(control).toContain('Architecture: all')
    expect(systemdUserUnit()).toContain('ExecStart=/usr/bin/workspace-manager mcp --http')
  })

  it('writes launchers, systemd unit, and control metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-manager-deb-'))
    const cliJsPath = join(root, 'index.js')
    try {
      await writeFile(cliJsPath, 'console.log("cli")\n')
      const staging = join(root, 'tree')
      writeDebianTree({
        root: staging,
        version: '0.1.0',
        cliJsPath,
        packageJsonPath: join(root, 'package.json')
      })
      const control = await readFile(join(staging, 'DEBIAN/control'), 'utf8')
      expect(control).toContain('Package: workspace-manager-cli')
      const launcher = await readFile(join(staging, 'usr/bin/wsm'), 'utf8')
      expect(launcher).toContain('/usr/lib/workspace-manager-cli/index.js')
      const unit = await readFile(join(staging, 'usr/lib/systemd/user/workspace-manager-mcp.service'), 'utf8')
      expect(unit).toContain('--port 3847')
      const mode = async (path: string) => (await stat(join(staging, path))).mode & 0o777
      expect(await mode('usr/bin/wsm')).toBe(0o755)
      expect(await mode('usr/lib/workspace-manager-cli/package.json')).toBe(0o644)
      expect(await mode('usr/lib/systemd/user/workspace-manager-mcp.service')).toBe(0o644)
      expect(await mode('usr/share/doc/workspace-manager-cli')).toBe(0o755)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
