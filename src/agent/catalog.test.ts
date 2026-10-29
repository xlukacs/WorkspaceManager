import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  AmbiguousCommandError,
  AmbiguousWorkspaceError,
  catalogFromState,
  findWorkspace,
  listWorkspaceCommands,
  listWorkspaceCommandsIn,
  listWorkspaces,
  resolveRunnable,
  WorktreeNotFoundError
} from '@agent/catalog'
import { legacyCommandWorkspace } from '@main/services/workspaceCommands'
import type { LegacyWorkspaceRecord, LegacyState } from '@shared/types'

function workspace(overrides: Partial<LegacyWorkspaceRecord> & Pick<LegacyWorkspaceRecord, 'id' | 'name' | 'rootPath'>): LegacyWorkspaceRecord {
  return {
    nameOverride: null,
    order: 0,
    groupIds: ['active'],
    packageManager: 'pnpm',
    isMonorepo: false,
    rootScripts: { dev: 'vite', build: 'tsc' },
    workspacePackages: [],
    docker: null,
    pythonEnvironment: null,
    commandChains: {},
    favoriteCommandIds: [],
    runActions: [],
    defaultRunActionId: null,
    lastScanAt: 1,
    quickLinks: [],
    gitSummary: { branch: 'main', isDirty: false, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, lastCommitSubject: 'init', lastCommitRelative: '1h ago', lastCommitTimestamp: 1 },
    gitWorktrees: [],
    gitWorktreesRoot: null,
    ...overrides
  }
}

const demo = workspace({
  id: 'p1',
  name: 'demo',
  rootPath: '/repos/demo',
  isMonorepo: true,
  workspacePackages: [{
    id: 'w1',
    name: 'web',
    relativePath: 'apps/web',
    absPath: '/repos/demo/apps/web',
    scripts: { dev: 'vite', test: 'vitest' }
  }],
  docker: { composeFile: 'compose.yaml', dockerfile: null, services: ['api'] },
  runActions: [{ id: 'boot', command: 'pnpm dev --host', description: 'Boot stack' }],
  defaultRunActionId: 'boot',
  favoriteCommandIds: ['p1::root::dev']
})

const other = workspace({
  id: 'p2',
  name: 'other',
  rootPath: '/repos/other',
  groupIds: ['client'],
  rootScripts: { test: 'vitest' }
})

const state: LegacyState = {
  version: 11,
  groups: [
    { id: 'active', name: 'Active', order: 0 },
    { id: 'client', name: 'Client', order: 1 }
  ],
  workspaces: [demo, other],
  terminals: [],
  settings: { preferredShell: 'bash' }
}

const catalog = catalogFromState(state, '/tmp/workspace-manager.json')

// Requested worktrees must exist on disk, so worktree tests point at a real directory.
const featureCheckout = mkdtempSync(join(tmpdir(), 'wsm-catalog-feature-'))
afterAll(() => rmSync(featureCheckout, { recursive: true, force: true }))

describe('agent catalog', () => {
  it('lists workspaces with collection names and git summaries', () => {
    const listed = listWorkspaces(catalog)
    expect(listed.map((item) => item.name)).toEqual(['demo', 'other'])
    expect(listed[0]?.branch).toBe('main')
    expect(listed[0]?.hasDocker).toBe(true)
    expect(listWorkspaces(catalog, 'Client')).toEqual([expect.objectContaining({ name: 'other' })])
  })

  it('finds a project by name, id, or path and rejects ambiguous names', () => {
    expect(findWorkspace(catalog, 'demo').id).toBe('p1')
    expect(findWorkspace(catalog, 'p2').name).toBe('other')
    expect(findWorkspace(catalog, '/repos/demo').id).toBe('p1')
    const cloned = catalogFromState({
      ...state,
      workspaces: [demo, workspace({ id: 'p3', name: 'demo', rootPath: '/repos/demo-2' })]
    })
    expect(() => findWorkspace(cloned, 'demo')).toThrow(AmbiguousWorkspaceError)
  })

  it('lists script, docker, and run-action commands', () => {
    const commands = listWorkspaceCommands(legacyCommandWorkspace(demo))
    expect(commands.some((command) => command.id === 'p1::root::dev' && command.favorite)).toBe(true)
    expect(commands.some((command) => command.kind === 'docker' && command.title === 'Compose Up')).toBe(true)
    expect(commands.some((command) => command.kind === 'run-action' && command.title === 'Boot stack')).toBe(true)
  })

  it('resolves runnables by command id, script name, docker title, and run action', () => {
    expect(resolveRunnable(catalog, { command: 'p1::root::build' }).plan.steps[0]?.shellLine).toBe('pnpm run build')
    expect(resolveRunnable(catalog, { project: 'demo', command: 'build' }).command.id).toBe('p1::root::build')
    expect(resolveRunnable(catalog, { project: 'demo', command: 'Compose Up' }).command.kind).toBe('docker')
    expect(resolveRunnable(catalog, { project: 'demo', command: 'Boot stack' }).command.kind).toBe('run-action')
    expect(resolveRunnable(catalog, { project: 'demo', command: 'web/test' }).command.id).toBe('p1::w1::test')
  })

  it('rejects ambiguous short command names', () => {
    expect(() => resolveRunnable(catalog, { project: 'demo', command: 'dev' })).toThrow(AmbiguousCommandError)
  })

  it('runs in a known worktree by path or branch and rejects unknown ones', () => {
    const withWorktrees = catalogFromState({
      ...state,
      workspaces: [{
        ...demo,
        gitWorktrees: [
          { path: '/repos/demo', branch: 'main', head: null, isMain: true, isBare: false, isLocked: false, isDirty: false, isMissing: false, lastActivityAt: null, lastActivityRelative: null },
          { path: featureCheckout, branch: 'feature/x', head: null, isMain: false, isBare: false, isLocked: false, isDirty: false, isMissing: false, lastActivityAt: null, lastActivityRelative: null },
          { path: '/worktrees/gone', branch: 'gone', head: null, isMain: false, isBare: false, isLocked: false, isDirty: false, isMissing: false, lastActivityAt: null, lastActivityRelative: null },
          { path: '/worktrees/pruned', branch: 'pruned', head: null, isMain: false, isBare: false, isLocked: false, isDirty: false, isMissing: true, lastActivityAt: null, lastActivityRelative: null }
        ]
      }, other]
    })
    const cwdFor = (worktree: string) =>
      resolveRunnable(withWorktrees, { project: 'demo', command: 'build', worktree }).plan.steps[0]?.cwd
    expect(cwdFor(featureCheckout)).toBe(featureCheckout)
    expect(cwdFor('feature/x')).toBe(featureCheckout)
    expect(() => cwdFor('/tmp')).toThrow(WorktreeNotFoundError)
    expect(() => cwdFor('gone')).toThrow('missing on disk')
    expect(() => cwdFor('pruned')).toThrow('missing on disk')
  })

  it('reports each command cwd in the requested worktree', () => {
    const withWorktrees = {
      ...legacyCommandWorkspace(demo),
      gitWorktrees: [
        { path: '/repos/demo', branch: 'main', head: null, isMain: true, isBare: false, isLocked: false },
        { path: featureCheckout, branch: 'feature/x', head: null, isMain: false, isBare: false, isLocked: false }
      ]
    }
    const cwdOf = (commands: ReturnType<typeof listWorkspaceCommands>, kind: string) =>
      commands.find((command) => command.kind === kind)?.cwd

    const main = listWorkspaceCommands(withWorktrees)
    expect(cwdOf(main, 'run-action')).toBe('/repos/demo')
    expect(cwdOf(main, 'script')).toBe('/repos/demo')

    const feature = listWorkspaceCommandsIn(withWorktrees, 'feature/x')
    expect(cwdOf(feature, 'run-action')).toBe(featureCheckout)
    expect(cwdOf(feature, 'script')).toBe(featureCheckout)
    expect(cwdOf(feature, 'docker')).toBe(featureCheckout)
    expect(() => listWorkspaceCommandsIn(withWorktrees, 'missing')).toThrow(WorktreeNotFoundError)
  })
})
