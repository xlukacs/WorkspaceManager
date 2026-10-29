#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLI_DEB_PACKAGE, debFileName, writeDebianTree } from './cli-deb-layout.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

function parseArgs(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags[key] = next
      index += 1
    } else {
      flags[key] = true
    }
  }
  return flags
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 'unknown'}`)
  }
}

const flags = parseArgs(process.argv.slice(2))
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const version = pkg.version
const cliJsPath = resolve(repoRoot, flags['cli-js'] || 'out/cli/index.js')
const outputDir = resolve(repoRoot, flags.out || join('release', version))
const skipDpkg = flags['skip-dpkg'] === true
const staging = flags.staging
  ? resolve(String(flags.staging))
  : mkdtempSync(join(tmpdir(), `${CLI_DEB_PACKAGE}-`))

if (!existsSync(cliJsPath)) {
  console.error(`CLI bundle not found at ${cliJsPath}. Run pnpm cli:build first.`)
  process.exit(1)
}

mkdirSync(staging, { recursive: true })
writeDebianTree({
  root: staging,
  version,
  cliJsPath,
  packageJsonPath: join(repoRoot, 'package.json')
})

if (skipDpkg) {
  console.info(`Wrote Debian tree to ${staging}`)
  process.exit(0)
}

if (!existsSync('/usr/bin/dpkg-deb') && spawnSync('dpkg-deb', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error('dpkg-deb is required to build the CLI package. Install dpkg or run on Debian/Ubuntu.')
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })
const debPath = join(outputDir, debFileName(version))
run('dpkg-deb', ['--root-owner-group', '--build', staging, debPath])

if (!flags.staging) rmSync(staging, { recursive: true, force: true })
console.info(`Built ${debPath}`)
console.info('Install with: sudo dpkg -i ' + debPath)
console.info('Update later with the same command for a newer version.')
