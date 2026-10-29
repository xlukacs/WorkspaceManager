import { describe, expect, it } from 'vitest'
import fixture from './fixtures/store-v11.json'
import type { PersistedState } from './persistedState'
import { decodeWorkspaceState, legacyWorkspaceView, projectPythonEnvironment } from './workspaceModel'
import { listCommands, resolveCommandRunPlan } from '@main/services/commands'
import { listDockerCommands } from '@main/services/docker'
import { runActionCommandId } from './runActions'

const legacy = () => structuredClone(fixture) as PersistedState

describe('workspace model decoding', () => {
  it('handles ungrouped workspaces and stores root and package data as projects', () => {
    const state = legacy()
    state.collections = []
    state.projects[0]!.collectionIds = []
    const migrated = decodeWorkspaceState(state)
    expect(migrated.workspaces[0]?.groupId).toBeNull()
    expect(migrated.migrationNotes).toEqual([])
    expect(migrated.workspaces[0]?.projects.map((project) => project.id)).toEqual(['root', 'pkg-web'])
    expect(migrated.workspaces[0]?.projects[0]).toMatchObject({
      relativePath: '', source: 'root', capabilities: ['node', 'python', 'docker'],
      scripts: { dev: 'vite', build: 'tsc' }, docker: fixture.projects[0]!.docker,
      python: { venvRelativePath: '.venv', installSource: null }
    })
  })

  it('keeps a single membership without producing a dropped-membership note', () => {
    const state = legacy()
    state.projects[0]!.collectionIds = ['backend']
    const migrated = decodeWorkspaceState(state)
    expect(migrated.workspaces[0]?.groupId).toBe('backend')
    expect(migrated.migrationNotes).toEqual([])
    expect(migrated.groups.map((group) => group.color)).toEqual([null, null])
  })

  it('chooses membership by sidebar order and reports every dropped membership', () => {
    const state = legacy()
    state.collections[0]!.order = 5
    state.collections[1]!.order = 0
    const migrated = decodeWorkspaceState(state)
    expect(migrated.workspaces[0]?.groupId).toBe('backend')
    expect(migrated.migrationNotes).toEqual(["demo was also in 'Active'; kept 'Backend'"])
    expect(migrated.terminals[0]).toMatchObject({ workspaceId: 'p1', projectId: null })
  })

  it('converts Windows environment paths and resolves executables inside the chosen checkout', () => {
    const state = legacy()
    const workspace = state.projects[0]!
    workspace.rootPath = 'C:\\repos\\demo'
    workspace.pythonEnvironment!.rootPath = 'C:\\repos\\demo\\.venv'
    const migrated = decodeWorkspaceState(state).workspaces[0]!
    expect(migrated.projects[0]?.python?.venvRelativePath).toBe('.venv')
    const environment = projectPythonEnvironment(migrated, migrated.projects[0]!, 'C:\\checkouts\\feature', true)
    expect(environment?.pythonPath).toBe('C:\\checkouts\\feature\\.venv\\Scripts\\python.exe')
    expect(environment?.rootPath).not.toContain('repos')
  })

  it('preserves existing command IDs, favorites, prerequisites, Docker and Run actions', () => {
    const migrated = decodeWorkspaceState(legacy()).workspaces[0]!
    const view = legacyWorkspaceView(migrated)
    const ids = new Set([
      ...listCommands(view).groups.flatMap((group) => group.commands.map((command) => command.id)),
      ...listDockerCommands(view).groups.flatMap((group) => group.commands.map((command) => command.id)),
      ...(view.runActions ?? []).map((action) => runActionCommandId(view.id, action.id))
    ])
    for (const id of fixture.projects[0]!.favoriteCommandIds) expect(ids.has(id)).toBe(true)
    expect(ids.has('p1::docker::compose-up')).toBe(true)
    expect(ids.has('p1::run-action::boot')).toBe(true)
    expect(resolveCommandRunPlan(view, 'p1::root::build')?.steps.map((step) => step.commandId)).toEqual([
      'p1::pkg-web::test', 'p1::root::build'
    ])
    expect(migrated.favoriteCommandIds).toEqual(fixture.projects[0]!.favoriteCommandIds)
    expect(migrated.commandChains).toEqual(fixture.projects[0]!.commandChains)
  })

  it('reads v14 idempotently and preserves group colors and per-workspace settings', () => {
    const state = decodeWorkspaceState(legacy())
    state.groups[0]!.color = '#44aa77'
    state.workspaces[0]!.openTarget = 'cursor'
    state.migrationNotes = []
    expect(decodeWorkspaceState(state)).toEqual(state)
    expect(() => decodeWorkspaceState({ ...state, version: 15 })).toThrow('Unsupported workspace store version: 15')
  })
})
