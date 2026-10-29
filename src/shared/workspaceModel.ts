import { normalizeSettings } from './settings'
import { defaultUiState } from './navigation'
import { joinPaths } from './pathUtils'
import { stateFromDisk, type PersistedState } from './persistedState'
import {
  normalizeLegacyWorkspaceRecord, normalizeGitWorktree,
  type DetectedProject, type LegacyState, type LegacyWorkspaceRecord,
  type PythonEnvironment, type StoredState, type WorkspaceRecord
} from './types'

export const WORKSPACE_STORE_VERSION = 14

function relativeEnvironmentPath(rootPath: string, targetPath: string) {
  const root = rootPath.replaceAll('\\', '/').replace(/\/$/, '')
  const target = targetPath.replaceAll('\\', '/')
  if (target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return target.slice(root.length + 1)
  // v11 discovery finds environments directly inside the workspace. An external
  // or cross-drive environment cannot be reused inside arbitrary worktrees.
  return null
}

export function workspaceFromLegacy(input: LegacyWorkspaceRecord, groupId: string | null): WorkspaceRecord {
  const workspace = normalizeLegacyWorkspaceRecord(input)
  const {
    groupIds: _groups, packageManager, isMonorepo: _monorepo, rootScripts,
    workspacePackages, docker, pythonEnvironment, pinnedPorts: _ports, ...rest
  } = workspace
  const node = packageManager !== 'unknown' || Object.keys(rootScripts).length > 0 || workspacePackages.length > 0
  const root: DetectedProject = {
    id: 'root', name: workspace.name, relativePath: '', source: 'root',
    capabilities: [...(node ? ['node' as const] : []), ...(pythonEnvironment ? ['python' as const] : []), ...(docker ? ['docker' as const] : [])],
    packageManager: node ? packageManager === 'unknown' ? 'npm' : packageManager : null,
    scripts: rootScripts,
    docker,
    python: pythonEnvironment ? {
      venvRelativePath: relativeEnvironmentPath(workspace.rootPath, pythonEnvironment.rootPath),
      installSource: null
    } : null
  }
  return {
    ...rest, groupId, openTarget: null,
    projects: [root, ...workspacePackages.map((project): DetectedProject => ({
      id: project.id, name: project.name,
      relativePath: project.relativePath === '.' ? '' : project.relativePath.replaceAll('\\', '/'),
      source: 'declared', capabilities: ['node'],
      packageManager: packageManager === 'unknown' ? 'npm' : packageManager,
      scripts: project.scripts, docker: null, python: null
    }))]
  }
}

export function rootProject(workspace: WorkspaceRecord) {
  return workspace.projects.find((project) => project.id === 'root') ?? workspace.projects[0] ?? null
}

export function workspacePackageManager(workspace: WorkspaceRecord) {
  return rootProject(workspace)?.packageManager
    ?? workspace.projects.find((project) => project.capabilities.includes('node'))?.packageManager
    ?? 'unknown'
}

export function workspaceIsMonorepo(workspace: WorkspaceRecord) {
  return workspace.projects.some((project) => project.id !== 'root' && project.capabilities.includes('node'))
}

export function projectPythonEnvironment(
  workspace: WorkspaceRecord, project: DetectedProject, checkoutPath = workspace.rootPath, windows = false
): PythonEnvironment | null {
  const venv = project.python?.venvRelativePath
  if (!venv) return null
  const rootPath = joinPaths(checkoutPath, project.relativePath, venv)
  const scriptsPath = joinPaths(rootPath, windows ? 'Scripts' : 'bin')
  return {
    id: `${workspace.id}::${project.id}::venv`, name: venv.split(/[\\/]/).at(-1) ?? venv,
    kind: 'venv', rootPath, scriptsPath, pythonPath: joinPaths(scriptsPath, windows ? 'python.exe' : 'python')
  }
}

/** Compatibility view for existing panels and v11-shaped CLI output. Never write this view to the v12 store. */
export function legacyWorkspaceView(workspace: WorkspaceRecord, windows = false): LegacyWorkspaceRecord {
  const { groupId, openTarget: _openTarget, projects: _projects, ...rest } = workspace
  const root = rootProject(workspace)
  return {
    ...rest, groupIds: groupId ? [groupId] : [],
    packageManager: workspacePackageManager(workspace), isMonorepo: workspaceIsMonorepo(workspace),
    rootScripts: root?.scripts ?? {}, docker: root?.docker ?? null,
    pythonEnvironment: root ? projectPythonEnvironment(workspace, root, workspace.rootPath, windows) : null,
    workspacePackages: workspace.projects.filter((project) => project.id !== 'root' && project.capabilities.includes('node')).map((project) => ({
      id: project.id, name: project.name, relativePath: project.relativePath,
      absPath: joinPaths(workspace.rootPath, project.relativePath), scripts: project.scripts,
      source: project.source, packageManager: project.packageManager
    }))
  }
}

export function normalizeWorkspaceRecord(workspace: WorkspaceRecord): WorkspaceRecord {
  return {
    ...workspace, nameOverride: workspace.nameOverride ?? null, order: workspace.order ?? 0,
    groupId: workspace.groupId ?? null, openTarget: workspace.openTarget ?? null,
    commandChains: workspace.commandChains ?? {}, favoriteCommandIds: workspace.favoriteCommandIds ?? [],
    runActions: workspace.runActions ?? [], defaultRunActionId: workspace.defaultRunActionId ?? null,
    pinnedEndpoints: workspace.pinnedEndpoints ?? [], quickLinks: workspace.quickLinks ?? [],
    gitWorktrees: (workspace.gitWorktrees ?? []).map(normalizeGitWorktree), gitWorktreesRoot: workspace.gitWorktreesRoot ?? null
  }
}

/** Pure decoding lets the app migrate and the headless CLI read old files without rewriting them. */
export function decodeWorkspaceState(input: Partial<PersistedState> | StoredState): StoredState {
  if ((input.version ?? 0) > WORKSPACE_STORE_VERSION) throw new Error(`Unsupported workspace store version: ${input.version}`)
  if ((input.version ?? 0) >= 12) {
    const state = input as StoredState
    return {
      ...state, version: WORKSPACE_STORE_VERSION, ui: { ...defaultUiState(), ...state.ui }, groups: state.groups.map((group) => ({ ...group, color: group.color ?? null })),
      workspaces: state.workspaces.map(normalizeWorkspaceRecord),
      terminals: state.terminals.map((terminal) => ({ ...terminal, projectId: terminal.projectId ?? null })),
      migrationNotes: state.migrationNotes ?? [],
      settings: normalizeSettings(state.settings)
    }
  }
  const disk = input as Partial<PersistedState>
  const legacy: LegacyState = stateFromDisk({
    version: disk.version ?? 0, collections: disk.collections ?? [], projects: disk.projects ?? [],
    terminals: disk.terminals ?? [], settings: disk.settings ?? { preferredShell: 'bash' }
  })
  const groups = [...legacy.groups].sort((left, right) => left.order - right.order).map((group) => ({ ...group, color: null }))
  const migrationNotes: string[] = []
  const workspaces = legacy.workspaces.map((workspace) => {
    const memberships = groups.filter((group) => workspace.groupIds.includes(group.id))
    const kept = memberships[0]
    for (const dropped of memberships.slice(1)) {
      migrationNotes.push(`${workspace.name} was also in '${dropped.name}'; kept '${kept!.name}'`)
    }
    return workspaceFromLegacy(workspace, kept?.id ?? null)
  })
  return {
    version: WORKSPACE_STORE_VERSION, groups, workspaces, settings: normalizeSettings(legacy.settings),
    terminals: legacy.terminals.map((terminal) => ({
      ...terminal, projectId: null, pinned: terminal.pinned ?? false,
      workspacePaused: terminal.workspacePaused ?? false,
      pythonEnvironment: terminal.pythonEnvironment ?? null, worktreePath: terminal.worktreePath ?? null
    })),
    migrationNotes, ui: defaultUiState()
  }
}

export function legacyStateView(state: StoredState, windows = false): LegacyState {
  return { ...state, workspaces: state.workspaces.map((workspace) => legacyWorkspaceView(workspace, windows)) }
}
