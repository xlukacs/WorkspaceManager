import { describe, expect, it } from 'vitest'
import { listCommands, rankScriptName, resolveCommandRunPlan, validateCommandChain } from '@main/services/commands'
import { normalizeComparePath } from '@shared/worktreeExecution'
import type { LegacyWorkspaceRecord } from '@shared/types'
import { afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoots: string[] = []

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'workspace-manager-commands-'))
  tempRoots.push(root)
  return root
}

const workspace: LegacyWorkspaceRecord = {
  id: 'p1',
  name: 'demo',
  rootPath: '/tmp/demo',
  groupIds: ['active'],
  packageManager: 'pnpm',
  isMonorepo: true,
  rootScripts: {
    setup: 'pnpm run setup',
    frontend: 'pnpm run frontend',
    dev: 'turbo run dev',
    build: 'turbo run build'
  },
  workspacePackages: [
    {
      id: 'w1',
      name: 'web',
      relativePath: 'apps/web',
      absPath: '/tmp/demo/apps/web',
      scripts: {
        dev: 'vite',
        test: 'vitest'
      }
    }
  ],
  docker: null,
  pythonEnvironment: null,
  commandChains: {
    'p1::root::dev': ['p1::root::frontend'],
    'p1::root::frontend': ['p1::root::setup'],
    'p1::w1::dev': ['p1::root::setup', 'p1::root::frontend']
  },
  favoriteCommandIds: ['p1::root::dev'],
  lastScanAt: Date.now(),
  quickLinks: [],
  gitSummary: null,
  gitWorktrees: [],
  gitWorktreesRoot: null,
  nameOverride: null,
  order: 0
}

describe('command ranking and resolution', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('prioritizes dev scripts', () => {
    expect(rankScriptName('dev')).toBeGreaterThan(rankScriptName('build'))
    expect(rankScriptName('frontend:dev')).toBeGreaterThan(rankScriptName('test'))
  })

  it('runs scanned Node projects directly with their nearest package manager', () => {
    const scanned: LegacyWorkspaceRecord = {
      ...workspace, commandChains: {},
      workspacePackages: [{ ...workspace.workspacePackages[0]!, source: 'scanned', packageManager: 'yarn' }]
    }
    expect(resolveCommandRunPlan(scanned, 'p1::w1::dev')?.steps[0]).toMatchObject({
      cwd: '/tmp/demo/apps/web', shellLine: 'yarn run dev'
    })
  })

  it('marks favorites first and exposes prerequisite metadata', () => {
    const result = listCommands(workspace)
    expect(result.favorites[0]?.name).toBe('dev')
    expect(result.groups[0]?.commands[0]?.name).toBe('dev')
    expect(result.groups[0]?.commands[0]?.prerequisiteTitles).toEqual(['frontend'])
    expect(result.groups[0]?.commands[0]?.hasChain).toBe(true)
  })

  it('resolves nested prerequisites in order', () => {
    const plan = resolveCommandRunPlan(workspace, 'p1::root::dev')
    expect(plan?.kind).toBe('chain')
    expect(plan?.steps.map((step) => step.commandId)).toEqual([
      'p1::root::setup',
      'p1::root::frontend',
      'p1::root::dev'
    ])
  })

  it('collapses duplicate prerequisites while keeping first occurrence order', () => {
    const plan = resolveCommandRunPlan(workspace, 'p1::w1::dev')
    expect(plan?.steps.map((step) => step.commandId)).toEqual([
      'p1::root::setup',
      'p1::root::frontend',
      'p1::w1::dev'
    ])
  })

  it('resolves project commands in their project folder', () => {
    const plan = resolveCommandRunPlan(workspace, 'p1::w1::dev')
    expect(plan?.steps.at(-1)?.cwd).toBe('/tmp/demo/apps/web')
    expect(plan?.steps.at(-1)?.shellLine).toBe('pnpm run dev')
  })

  it('runs project commands inside their selected worktree folder', async () => {
    const root = await makeTempRoot()
    const worktree = join(root, '.worktrees', 'feature-auth')
    await mkdir(join(worktree, 'apps', 'web'), { recursive: true })
    const record: LegacyWorkspaceRecord = {
      ...workspace, rootPath: root,
      gitWorktrees: [
        { path: root, branch: 'main', head: null, isMain: true, isBare: false, isLocked: false },
        { path: worktree, branch: 'feature/auth', head: null, isMain: false, isBare: false, isLocked: false }
      ]
    }
    const plan = resolveCommandRunPlan(record, 'p1::w1::dev', worktree)
    expect(normalizeComparePath(plan?.steps.at(-1)?.cwd ?? '')).toBe(normalizeComparePath(join(worktree, 'apps', 'web')))
    expect(plan?.steps.at(-1)?.shellLine).toBe('pnpm run dev')
  })

  it('rejects self references and cycles', () => {
    expect(() => validateCommandChain(workspace, 'p1::root::dev', ['p1::root::dev'])).toThrow(
      'A command cannot depend on itself.'
    )

    expect(() => validateCommandChain({
      ...workspace,
      commandChains: {
        'p1::root::frontend': ['p1::root::dev']
      }
    }, 'p1::root::dev', ['p1::root::frontend'])).toThrow('Command prerequisite cycle detected.')
  })

  it('rejects unknown prerequisites', () => {
    expect(() => validateCommandChain(workspace, 'p1::root::dev', ['missing::command'])).toThrow(
      'Unknown prerequisite command: missing::command'
    )
  })

  it('adds a synthetic node install command when no install script exists', async () => {
    const root = await makeTempRoot()
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo-node' }))
    const nodeWorkspace: LegacyWorkspaceRecord = {
      ...workspace,
      id: 'node-project',
      rootPath: root,
      isMonorepo: false,
      packageManager: 'pnpm',
      rootScripts: { dev: 'vite' },
      workspacePackages: [],
      commandChains: {},
      favoriteCommandIds: []
    }

    const result = listCommands(nodeWorkspace)
    expect(result.groups[0]?.commands.map((command) => command.id)).toContain('node-project::synthetic::node-install')

    const plan = resolveCommandRunPlan(nodeWorkspace, 'node-project::synthetic::node-install')
    expect(plan?.steps).toHaveLength(1)
    expect(plan?.steps[0]?.shellLine).toBe('pnpm install')
  })

  it('adds a synthetic python install command and creates .venv when needed', async () => {
    const root = await makeTempRoot()
    await writeFile(join(root, 'pyproject.toml'), ['[project]', 'name = "python-demo"', 'version = "0.1.0"'].join('\n'))
    const pythonWorkspace: LegacyWorkspaceRecord = {
      ...workspace,
      id: 'python-project',
      name: 'python-demo',
      rootPath: root,
      packageManager: 'unknown',
      rootScripts: {},
      workspacePackages: [],
      isMonorepo: false,
      pythonEnvironment: null,
      commandChains: {},
      favoriteCommandIds: []
    }

    const result = listCommands(pythonWorkspace)
    expect(result.groups[0]?.commands.map((command) => command.id)).toContain('python-project::synthetic::python-install')

    const plan = resolveCommandRunPlan(pythonWorkspace, 'python-project::synthetic::python-install')
    expect(plan?.kind).toBe('chain')
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.steps[0]?.shellLine).toContain('-m venv .venv')
    expect(plan?.steps[1]?.shellLine).toContain('-m pip install -e .')
  })

  describe('python:install planning', () => {
    async function makePythonWorkspace(overrides: Partial<LegacyWorkspaceRecord> = {}) {
      const root = await makeTempRoot()
      await writeFile(join(root, 'requirements.txt'), 'requests\n')
      const worktreePath = join(root, '.worktrees', 'feature')
      await mkdir(worktreePath, { recursive: true })
      const pythonWorkspace: LegacyWorkspaceRecord = {
        ...workspace,
        id: 'py',
        name: 'py-demo',
        rootPath: root,
        packageManager: 'npm',
        isMonorepo: false,
        rootScripts: { dev: 'node server.js' },
        workspacePackages: [],
        pythonEnvironment: null,
        commandChains: {},
        favoriteCommandIds: [],
        gitWorktreesRoot: join(root, '.worktrees'),
        gitWorktrees: [
          { path: root, branch: 'main', head: 'abc', isMain: true, isBare: false, isLocked: false },
          { path: worktreePath, branch: 'feature', head: 'def', isMain: false, isBare: false, isLocked: false }
        ],
        ...overrides
      }
      return { root, worktreePath, pythonProject: pythonWorkspace }
    }

    it('runs every python:install step inside the selected worktree', async () => {
      const { worktreePath, pythonProject: pythonWorkspace } = await makePythonWorkspace()
      const plan = resolveCommandRunPlan(pythonWorkspace, 'py::synthetic::python-install', worktreePath)

      expect(plan?.steps.map((step) => step.title)).toEqual(['Create .venv', 'python:install'])
      for (const step of plan?.steps ?? []) {
        expect(normalizeComparePath(step.cwd)).toBe(normalizeComparePath(worktreePath))
      }
      expect(normalizeComparePath(plan?.steps[1]?.pythonEnvironment?.rootPath ?? '')).toBe(
        normalizeComparePath(join(worktreePath, '.venv'))
      )
    })

    it('remaps an existing project venv to the selected worktree', async () => {
      const { root, worktreePath, pythonProject: pythonWorkspace } = await makePythonWorkspace()
      pythonWorkspace.pythonEnvironment = {
        id: `${root}::.venv`,
        name: '.venv',
        kind: 'venv',
        rootPath: join(root, '.venv'),
        scriptsPath: join(root, '.venv', 'bin'),
        pythonPath: join(root, '.venv', 'bin', 'python')
      }

      const scripts = process.platform === 'win32' ? 'Scripts' : 'bin'
      const binary = process.platform === 'win32' ? 'python.exe' : 'python'
      await mkdir(join(worktreePath, '.venv', scripts), { recursive: true })
      await writeFile(join(worktreePath, '.venv', scripts, binary), '')
      const plan = resolveCommandRunPlan(pythonWorkspace, 'py::synthetic::python-install', worktreePath)
      expect(plan?.steps).toHaveLength(1)
      expect(normalizeComparePath(plan?.steps[0]?.cwd ?? '')).toBe(normalizeComparePath(worktreePath))
      expect(normalizeComparePath(plan?.steps[0]?.pythonEnvironment?.pythonPath ?? '')).toBe(
        normalizeComparePath(join(worktreePath, '.venv', scripts, binary))
      )
    })

    it('keeps venv creation when python:install is a chain prerequisite', async () => {
      const { pythonProject: pythonWorkspace } = await makePythonWorkspace({
        commandChains: { 'py::root::dev': ['py::synthetic::python-install'] }
      })
      const plan = resolveCommandRunPlan(pythonWorkspace, 'py::root::dev')

      expect(plan?.kind).toBe('chain')
      expect(plan?.steps.map((step) => step.commandId)).toEqual([
        'py::synthetic::python-install::create-env',
        'py::synthetic::python-install',
        'py::root::dev'
      ])
      expect(plan?.steps[0]?.shellLine).toMatch(/^(python3|py -3) -m venv \.venv$/)
      expect(plan?.steps[1]?.shellLine).toContain('-m pip install -r requirements.txt')
      expect(plan?.steps[2]?.shellLine).toBe('npm run dev')
    })
  })
})
