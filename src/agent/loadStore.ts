import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decodeWorkspaceState, legacyStateView } from '@shared/workspaceModel'
import type { LegacyState, StoredState } from '@shared/types'
import { workspaceFromDisk, terminalFromDisk, type PersistedState } from '@shared/persistedState'
import { normalizeLegacyWorkspaceRecord, sortWorkspaces } from '@shared/types'

export const STORE_ENV_VAR = 'WORKSPACE_MANAGER_STORE'
const STORE_FILE_NAME = 'workspace-manager.json'

export class StoreNotFoundError extends Error {
  constructor(public readonly searchedPaths: string[]) {
    super(
      searchedPaths.length === 0
        ? 'Workspace Manager store path is empty.'
        : `Workspace Manager store not found. Open the app once, or set ${STORE_ENV_VAR} to the JSON file.\nLooked in:\n${searchedPaths.map((path) => `  ${path}`).join('\n')}`
    )
    this.name = 'StoreNotFoundError'
  }
}

function uniquePaths(paths: Array<string | undefined | null>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path) continue
    const normalized = path.replace(/\\/g, '/')
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }
  return result
}

export function candidateStorePaths(options?: { storePath?: string | null; env?: NodeJS.ProcessEnv; home?: string }) {
  const env = options?.env ?? process.env
  const home = options?.home ?? homedir()
  const xdg = env.XDG_CONFIG_HOME
  const appData = env.APPDATA
  const configRoots = uniquePaths([
    xdg,
    appData,
    home ? join(home, '.config') : null,
    home ? join(home, 'Library', 'Application Support') : null
  ])
  const appNames = ['workspace-manager', 'Workspace Manager', 'WorkspaceManager']

  return uniquePaths([
    options?.storePath,
    env[STORE_ENV_VAR],
    ...configRoots.flatMap((root) => appNames.map((name) => join(root, name, STORE_FILE_NAME)))
  ])
}

export function resolveStorePath(options?: { storePath?: string | null; env?: NodeJS.ProcessEnv; home?: string }) {
  const searched = candidateStorePaths(options)
  const existing = searched.find((path) => existsSync(path))
  if (!existing) throw new StoreNotFoundError(searched)
  return existing
}

export function loadStoredState(options?: { storePath?: string | null; env?: NodeJS.ProcessEnv; home?: string }): LegacyState {
  const path = resolveStorePath(options)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedState> | StoredState
  if ((parsed.version ?? 0) >= 12) {
    const state = decodeWorkspaceState(parsed)
    state.settings.preferredShell = parsed.settings?.preferredShell ?? (process.platform === 'win32' ? 'powershell' : 'bash')
    return legacyStateView(state, process.platform === 'win32')
  }
  const legacy = parsed as Partial<PersistedState>
  const groups = legacy.collections ?? []
  const workspaces = sortWorkspaces((legacy.projects ?? []).map((workspace) => normalizeLegacyWorkspaceRecord(workspaceFromDisk(workspace))))
  return {
    version: parsed.version ?? 0,
    groups,
    workspaces,
    terminals: (legacy.terminals ?? []).map(terminalFromDisk),
    settings: {
      preferredShell: parsed.settings?.preferredShell ?? (process.platform === 'win32' ? 'powershell' : 'bash'),
      windowBounds: parsed.settings?.windowBounds
    }
  }
}

export function loadWorkspaceState(options?: { storePath?: string | null; env?: NodeJS.ProcessEnv; home?: string }): StoredState {
  const path = resolveStorePath(options)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedState> | StoredState
  const state = decodeWorkspaceState(parsed)
  state.settings.preferredShell = parsed.settings?.preferredShell ?? (process.platform === 'win32' ? 'powershell' : 'bash')
  return state
}
