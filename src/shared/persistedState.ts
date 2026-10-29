import type { LegacyState, TerminalSession, LegacyWorkspaceRecord } from './types'

// Phase 2A changes the in-memory vocabulary only. Keep the v11 disk format,
// including property order, until the versioned migration in Phase 2B.
export type PersistedWorkspace = Omit<LegacyWorkspaceRecord, 'groupIds'> & { collectionIds: string[] }
export type PersistedTerminal = Omit<TerminalSession, 'workspaceId' | 'projectId'> & { projectId: string }
export type PersistedState = Omit<LegacyState, 'groups' | 'workspaces' | 'terminals'> & {
  collections: LegacyState['groups']
  projects: PersistedWorkspace[]
  terminals: PersistedTerminal[]
}

function renameKey<T extends object, K extends keyof T, N extends string>(value: T, from: K, to: N) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key === from ? to : key, item])
  ) as Omit<T, K> & Record<N, T[K]>
}

export function workspaceFromDisk(workspace: PersistedWorkspace): LegacyWorkspaceRecord {
  return renameKey(workspace, 'collectionIds', 'groupIds')
}

export function workspaceToDisk(workspace: LegacyWorkspaceRecord): PersistedWorkspace {
  return renameKey(workspace, 'groupIds', 'collectionIds')
}

export function terminalFromDisk(terminal: PersistedTerminal): TerminalSession {
  return { ...renameKey(terminal, 'projectId', 'workspaceId'), projectId: null }
}

export function terminalToDisk(terminal: TerminalSession): PersistedTerminal {
  const { projectId: _detectedProjectId, ...legacy } = terminal
  return renameKey(legacy, 'workspaceId', 'projectId')
}

export function stateFromDisk(state: PersistedState): LegacyState {
  const renamed = renameKey(renameKey(state, 'collections', 'groups'), 'projects', 'workspaces')
  return {
    ...renamed,
    workspaces: renamed.workspaces.map(workspaceFromDisk),
    terminals: renamed.terminals.map(terminalFromDisk)
  }
}

export function stateToDisk(state: LegacyState): PersistedState {
  const renamed = renameKey(renameKey(state, 'groups', 'collections'), 'workspaces', 'projects')
  return {
    ...renamed,
    projects: renamed.projects.map(workspaceToDisk),
    terminals: renamed.terminals.map(terminalToDisk)
  }
}
