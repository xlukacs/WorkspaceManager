import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverProjects } from './projectDiscovery'
import { buildWorkspaceRecord } from './workspaceDiscovery'

const reads = vi.hoisted(() => ({ active: 0, peak: 0 }))
vi.mock('node:fs/promises', async (load) => {
  const original = await load<typeof import('node:fs/promises')>()
  return {
    ...original,
    readdir: async (path: string, options: { withFileTypes: true }) => {
      reads.active++
      reads.peak = Math.max(reads.peak, reads.active)
      try {
        await new Promise<void>((resolve) => setImmediate(resolve))
        return await original.readdir(path, options)
      } finally {
        reads.active--
      }
    }
  }
})

const roots: string[] = []
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'wsm-project-scan-'))
  roots.push(path)
  return path
}
async function file(path: string, relativePath: string, content = '') {
  const parts = relativePath.split('/')
  const name = parts.pop()!
  const directory = join(path, ...parts)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, name), content)
}
async function manifest(path: string, directory: string, values: object = {}) {
  await file(path, `${directory ? `${directory}/` : ''}package.json`, JSON.stringify(values))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  reads.active = 0
  reads.peak = 0
})

describe('detected project discovery', () => {
  it('always includes a root project, even for an empty folder', async () => {
    const path = await root()
    expect(await discoverProjects(path, { gitWorktrees: [] })).toEqual([{
      id: 'root', name: path.split(/[\\/]/).at(-1), relativePath: '', capabilities: [], source: 'root',
      packageManager: null, scripts: {}, docker: null, python: null
    }])
  })

  it('discovers the mixed Node/Python/Docker fixture and preserves declared package IDs', async () => {
    const path = await root()
    await manifest(path, '', { name: 'product', packageManager: 'pnpm@10.0.0', workspaces: ['apps/*'] })
    await manifest(path, 'apps/web', { name: '@product/web', scripts: { dev: 'vite' } })
    await file(path, 'services/api/requirements.txt', 'requests\n')
    await file(path, 'services/api/.venv/pyvenv.cfg')
    await file(path, 'services/api/.venv/bin/python')
    await file(path, 'infrastructure/compose.yaml', 'services:\n  database:\n    image: postgres\n')

    const projects = await discoverProjects(path, { gitWorktrees: [] })
    expect(projects.map((project) => project.relativePath)).toEqual(['', 'apps/web', 'infrastructure', 'services/api'])
    expect(projects[0]).toMatchObject({ id: 'root', name: 'product', capabilities: ['node'], source: 'root' })
    expect(projects[1]).toMatchObject({ capabilities: ['node'], source: 'declared', packageManager: 'pnpm', scripts: { dev: 'vite' } })
    expect(projects[2]).toMatchObject({ capabilities: ['docker'], packageManager: null, docker: { composeFile: 'compose.yaml', services: ['database'] } })
    expect(projects[3]).toMatchObject({ capabilities: ['python'], python: { venvRelativePath: '.venv', installSource: 'requirements' } })
    const previous = await buildWorkspaceRecord(path, [])
    expect(projects[1]?.id).toBe(previous.workspacePackages[0]?.id)
    expect(JSON.stringify(projects)).not.toContain(path)
  })

  it('merges capabilities in declared folders and ignores undeclared Node fixtures', async () => {
    const path = await root()
    await manifest(path, '', { workspaces: ['apps/*', '!apps/excluded'] })
    await manifest(path, 'apps/web', { name: 'web' })
    await file(path, 'apps/web/pyproject.toml', '[project]\nname = "python-web"\n')
    await file(path, 'apps/web/Dockerfile', 'FROM alpine\n')
    await manifest(path, 'apps/excluded', { name: 'excluded' })
    await manifest(path, 'fixtures/example', { name: 'fixture' })
    await file(path, 'fixtures/example/requirements.txt')
    const projects = await discoverProjects(path, { gitWorktrees: [] })
    expect(projects.filter((project) => project.relativePath === 'apps/web')).toHaveLength(1)
    expect(projects.find((project) => project.relativePath === 'apps/web')).toMatchObject({
      name: 'web', source: 'declared', capabilities: ['node', 'python', 'docker'],
      python: { venvRelativePath: null, installSource: 'pyproject' }
    })
    expect(projects.find((project) => project.relativePath === 'fixtures/example')).toMatchObject({
      capabilities: ['python'], packageManager: null, scripts: {}, source: 'scanned'
    })
    expect(projects.some((project) => project.relativePath === 'apps/excluded')).toBe(false)
  })

  it('retains root Python detection for existing markers and environments without a manifest', async () => {
    const pipfile = await root()
    await file(pipfile, 'Pipfile', '[packages]\nrequests = "*"\n')
    expect((await discoverProjects(pipfile, { gitWorktrees: [] }))[0]).toMatchObject({
      capabilities: ['python'], python: { venvRelativePath: null, installSource: null }
    })
    const environment = await root()
    await file(environment, '.venv/bin/python')
    expect((await discoverProjects(environment, { gitWorktrees: [] }))[0]).toMatchObject({
      capabilities: ['python'], python: { venvRelativePath: '.venv', installSource: null }
    })
    const requirements = await root()
    await file(requirements, 'requirements-dev.txt', 'pytest\n')
    expect((await discoverProjects(requirements, { gitWorktrees: [] }))[0]).toMatchObject({
      capabilities: ['python'], python: { venvRelativePath: null, installSource: 'requirements' }
    })
  })

  it('recognizes pnpm declarations without a root package.json and declares deep packages', async () => {
    const path = await root()
    await file(path, 'pnpm-workspace.yaml', 'packages:\n  - packages/**\n')
    await manifest(path, 'packages/a/b/c/d/deep', { name: 'deep', scripts: { build: 'tsc' } })
    await manifest(path, 'examples/fixture')
    const projects = await discoverProjects(path, { gitWorktrees: [] })
    expect(projects.map((project) => project.relativePath)).toEqual(['', 'packages/a/b/c/d/deep'])
    expect(projects[1]).toMatchObject({ source: 'declared', scripts: { build: 'tsc' } })
  })

  it('scans undeclared repositories and inherits the closest package manager field or lockfile', async () => {
    const path = await root()
    await manifest(path, '', { packageManager: 'pnpm@10.0.0' })
    await manifest(path, 'services', { packageManager: 'yarn@4.0.0' })
    await manifest(path, 'services/api', { scripts: { start: 'node server.js' } })
    await manifest(path, 'services/worker')
    await file(path, 'services/worker/package-lock.json', '{}')
    await manifest(path, 'tools/cli')
    const projects = await discoverProjects(path, { gitWorktrees: [] })
    expect(projects.find((project) => project.relativePath === 'services/api')).toMatchObject({ source: 'scanned', packageManager: 'yarn' })
    expect(projects.find((project) => project.relativePath === 'services/worker')?.packageManager).toBe('npm')
    expect(projects.find((project) => project.relativePath === 'tools/cli')?.packageManager).toBe('pnpm')
    const noManager = await root()
    await manifest(noManager, 'app')
    expect((await discoverProjects(noManager, { gitWorktrees: [] }))[1]?.packageManager).toBe('npm')
  })

  it('stops recursive discovery after depth four', async () => {
    const path = await root()
    await manifest(path, 'one/two/three/four')
    await file(path, 'one/two/three/four/five/requirements.txt')
    const projects = await discoverProjects(path, { gitWorktrees: [] })
    expect(projects.map((project) => project.relativePath)).toEqual(['', 'one/two/three/four'])
  })

  it('ignores generated folders and both configured and linked worktrees, including declared globs', async () => {
    const path = await root()
    await manifest(path, '', { workspaces: ['**'] })
    for (const folder of ['node_modules', '.git', '.venv', 'venv', 'env', 'pycache', '__pycache__', 'dist', 'build', 'out', '.next', '.turbo', '.cache', 'coverage', '.worktrees', 'checkouts', 'linked']) {
      await manifest(path, `${folder}/fixture`, { name: folder })
      await file(path, `${folder}/fixture/requirements.txt`)
      await file(path, `${folder}/fixture/Dockerfile`)
    }
    await manifest(path, 'apps/real', { name: 'real' })
    const projects = await discoverProjects(path, {
      gitWorktreesRoot: join(path, 'checkouts'),
      gitWorktrees: [
        { path, branch: 'main', head: null, isMain: true, isBare: false, isLocked: false },
        { path: join(path, 'linked'), branch: 'feature', head: null, isMain: false, isBare: false, isLocked: false }
      ]
    })
    expect(projects.map((project) => project.relativePath)).toEqual(['', 'apps/real'])
  })

  it('bounds simultaneous directory reads in a wide repository', async () => {
    const path = await root()
    await Promise.all(Array.from({ length: 40 }, (_, index) => manifest(path, `services/service-${index}`)))
    const projects = await discoverProjects(path, { gitWorktrees: [] })
    expect(projects).toHaveLength(41)
    expect(reads.peak).toBeGreaterThan(1)
    expect(reads.peak).toBeLessThanOrEqual(16)
    expect(reads.active).toBe(0)
  })
})
