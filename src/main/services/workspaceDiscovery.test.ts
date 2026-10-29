import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWorkspaceRecord, detectWorkspaceCandidate, findCandidatesFromPaths } from '@main/services/workspaceDiscovery'

const tempRoots: string[] = []

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'workspace-manager-'))
  tempRoots.push(root)
  return root
}

describe('project discovery', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) =>
        rm(root, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 50
        })
      )
    )
  })

  it('detects a standalone npm project', async () => {
    const root = await makeTempRoot()
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'solo',
      scripts: { dev: 'vite' }
    }))

    const candidate = await detectWorkspaceCandidate(root)
    const record = await buildWorkspaceRecord(root, ['active'])

    expect(candidate?.hasPackageJson).toBe(true)
    expect(record.packageManager).toBe('npm')
    expect(record.rootScripts.dev).toBe('vite')
    expect(record.workspacePackages).toHaveLength(0)
    expect(record.gitWorktrees).toEqual([])
  })

  it('detects a pnpm monorepo', async () => {
    const root = await makeTempRoot()
    await mkdir(join(root, 'apps', 'web'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'mono',
      packageManager: 'pnpm@9.0.0',
      scripts: { dev: 'pnpm --filter web dev' }
    }))
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    await writeFile(join(root, 'apps', 'web', 'package.json'), JSON.stringify({
      name: 'web',
      scripts: { dev: 'vite' }
    }))

    const record = await buildWorkspaceRecord(root, ['active'])

    expect(record.packageManager).toBe('pnpm')
    expect(record.isMonorepo).toBe(true)
    expect(record.workspacePackages[0]?.name).toBe('web')
  })

  it('detects docker compose services and Dockerfile', async () => {
    const root = await makeTempRoot()
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'docker-demo' }))
    await writeFile(join(root, 'compose.yaml'), 'services:\n  api:\n    image: node:20\n  web:\n    image: nginx:alpine\n')
    await writeFile(join(root, 'Dockerfile'), 'FROM node:20-alpine\n')

    const record = await buildWorkspaceRecord(root, ['active'])

    expect(record.docker?.composeFile).toBe('compose.yaml')
    expect(record.docker?.dockerfile).toBe('Dockerfile')
    expect(record.docker?.services).toEqual(['api', 'web'])
  })

  it('detects npm workspaces', async () => {
    const root = await makeTempRoot()
    await mkdir(join(root, 'packages', 'api'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      workspaces: ['packages/*'],
      scripts: { dev: 'npm run dev --workspace api' }
    }))
    await writeFile(join(root, 'packages', 'api', 'package.json'), JSON.stringify({
      name: 'api',
      scripts: { dev: 'tsx watch src/index.ts' }
    }))

    const record = await buildWorkspaceRecord(root, ['active'])

    expect(record.packageManager).toBe('npm')
    expect(record.workspacePackages).toHaveLength(1)
    expect(record.workspacePackages[0]?.name).toBe('api')
  })

  it('accepts a git-only repo without package metadata', async () => {
    const root = await makeTempRoot()
    await mkdir(join(root, '.git'))

    const candidate = await detectWorkspaceCandidate(root)
    const record = await buildWorkspaceRecord(root, ['active'])

    expect(candidate?.hasGit).toBe(true)
    expect(record.rootScripts).toEqual({})
    expect(record.packageManager).toBe('unknown')
  })

  it('detects python projects and local virtual environments', async () => {
    const root = await makeTempRoot()
    await mkdir(join(root, '.venv', 'Scripts'), { recursive: true })
    await writeFile(
      join(root, 'pyproject.toml'),
      ['[project]', 'name = "python-service"', 'version = "0.1.0"'].join('\n')
    )
    await writeFile(join(root, '.venv', 'pyvenv.cfg'), 'home = C:\\Python313\n')
    await writeFile(join(root, '.venv', 'Scripts', 'python.exe'), '')

    const candidate = await detectWorkspaceCandidate(root)
    const record = await buildWorkspaceRecord(root, ['active'])

    expect(candidate).not.toBeNull()
    expect(record.name).toBe('python-service')
    expect(record.pythonEnvironment?.name).toBe('.venv')
    expect(record.pythonEnvironment?.pythonPath).toContain('.venv')
  })

  it('accepts a Docker-only folder as an import candidate', async () => {
    const dockerfileOnly = await makeTempRoot()
    await writeFile(join(dockerfileOnly, 'Dockerfile'), 'FROM alpine\n')
    const composeOnly = await makeTempRoot()
    await writeFile(join(composeOnly, 'docker-compose.yml'), 'services:\n  api:\n    image: alpine\n')
    const empty = await makeTempRoot()

    const candidates = await findCandidatesFromPaths([dockerfileOnly])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ rootPath: dockerfileOnly, hasGit: false, hasPackageJson: false })
    expect(await detectWorkspaceCandidate(composeOnly)).not.toBeNull()
    expect(await detectWorkspaceCandidate(empty)).toBeNull()
  })
})
