import { listWorkspaceCommands as commandList, resolveRunPlan } from '@main/services/workspaceCommands'
import { resolveRunWorktreePath } from '@main/services/runWorktree'
import { runActionCommandId } from '@shared/runActions'
import { decodeWorkspaceState, legacyWorkspaceView } from '@shared/workspaceModel'
import { stateToDisk } from '@shared/persistedState'
import {
  listWorkspaceWorktrees,
  normalizeComparePath,
  WorktreeNotFoundError
} from '@shared/worktreeExecution'
import type {
  LegacyGroupRecord,
  CommandRunPlan,
  GitWorktree,
  LegacyWorkspaceRecord,
  WorkspaceRecord,
  StoredState,
  ShellPreference,
  LegacyState,
  TerminalSession
} from '@shared/types'
import { loadWorkspaceState, resolveStorePath } from '@agent/loadStore'

export { WorktreeNotFoundError }

export type AgentCommandKind = 'script' | 'docker' | 'run-action'

// CLI/MCP payload keys retain their v11 names during the internal vocabulary rename.
export interface AgentCommand {
  id: string
  projectId: string
  kind: AgentCommandKind
  name: string
  title: string
  cwd: string
  favorite: boolean
  description?: string
  shellPreview: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  rootPath: string
  collections: string[]
  packageManager: LegacyWorkspaceRecord['packageManager']
  isMonorepo: boolean
  branch: string | null
  isDirty: boolean
  worktreeCount: number
  favoriteCommandCount: number
  runActionCount: number
  hasDocker: boolean
}

export interface WorkspaceDetails extends WorkspaceSummary {
  projects: WorkspaceRecord['projects']
  groupId: string | null
  openTarget: WorkspaceRecord['openTarget']
  gitWorktreesRoot: string | null
  worktrees: GitWorktree[]
  rootScripts: string[]
  workspacePackages: Array<{ name: string; relativePath: string; absPath: string }>
  runActions: Array<{ id: string; command: string; description: string; default: boolean }>
  docker: LegacyWorkspaceRecord['docker']
  pythonEnvironment: LegacyWorkspaceRecord['pythonEnvironment']
  pinnedEndpoints: NonNullable<LegacyWorkspaceRecord['pinnedEndpoints']>
  lastScanAt: number
}

export interface AgentCatalog {
  storePath: string
  groups: LegacyGroupRecord[]
  workspaces: WorkspaceRecord[]
  terminals: TerminalSession[]
  preferredShell: ShellPreference
  nodeCaCertificate?: string | null
}

export class WorkspaceNotFoundError extends Error {
  constructor(query: string) {
    super(`Unknown workspace: ${query}`)
    this.name = 'ProjectNotFoundError'
  }
}

export class AmbiguousWorkspaceError extends Error {
  constructor(query: string, public readonly matches: Array<{ id: string; name: string; rootPath: string }>) {
    super(
      `Ambiguous workspace "${query}". Matches:\n${matches.map((match) => `  ${match.name}  ${match.id}  ${match.rootPath}`).join('\n')}`
    )
    this.name = 'AmbiguousProjectError'
  }
}

export class CommandNotFoundError extends Error {
  constructor(query: string) {
    super(`Unknown command: ${query}`)
    this.name = 'CommandNotFoundError'
  }
}

export class AmbiguousCommandError extends Error {
  constructor(query: string, public readonly matches: AgentCommand[]) {
    super(
      `Ambiguous command "${query}". Matches:\n${matches.map((match) => `  ${match.id}  ${match.title}`).join('\n')}`
    )
    this.name = 'AmbiguousCommandError'
  }
}

export function loadCatalog(options?: { storePath?: string | null; env?: NodeJS.ProcessEnv; home?: string }): AgentCatalog {
  const storePath = resolveStorePath(options)
  return catalogFromState(loadWorkspaceState({ ...options, storePath }), storePath)
}

export function catalogFromState(input: LegacyState | StoredState, storePath = ''): AgentCatalog {
  const state = input.workspaces.every((workspace) => 'projects' in workspace)
    ? decodeWorkspaceState(input as StoredState)
    : decodeWorkspaceState(stateToDisk(input as LegacyState))
  return {
    storePath,
    groups: state.groups,
    workspaces: state.workspaces,
    terminals: state.terminals,
    nodeCaCertificate: state.settings.nodeCaCertificate,
    preferredShell: state.settings.preferredShell
  }
}

function groupName(catalog: AgentCatalog, groupId: string) {
  return catalog.groups.find((group) => group.id === groupId)?.name ?? groupId
}

export function summarizeWorkspace(catalog: AgentCatalog, workspace: WorkspaceRecord): WorkspaceSummary {
  const worktrees = listWorkspaceWorktrees(workspace)
  const view = legacyWorkspaceView(workspace, process.platform === 'win32')
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.rootPath,
    collections: (workspace.groupId ? [workspace.groupId] : []).map((id) => groupName(catalog, id)),
    packageManager: view.packageManager,
    isMonorepo: view.isMonorepo,
    branch: workspace.gitSummary?.branch ?? null,
    isDirty: workspace.gitSummary?.isDirty ?? false,
    worktreeCount: worktrees.length,
    favoriteCommandCount: workspace.favoriteCommandIds.length,
    runActionCount: workspace.runActions?.length ?? 0,
    hasDocker: workspace.projects.some((project) => Boolean(project.docker?.composeFile || project.docker?.dockerfile))
  }
}

export function getWorkspaceDetails(catalog: AgentCatalog, workspace: WorkspaceRecord): WorkspaceDetails {
  const summary = summarizeWorkspace(catalog, workspace)
  const view = legacyWorkspaceView(workspace, process.platform === 'win32')
  return {
    ...summary,
    projects: workspace.projects, groupId: workspace.groupId, openTarget: workspace.openTarget,
    gitWorktreesRoot: workspace.gitWorktreesRoot,
    worktrees: listWorkspaceWorktrees(workspace),
    rootScripts: Object.keys(view.rootScripts),
    workspacePackages: view.workspacePackages.map((project) => ({
      name: project.name,
      relativePath: project.relativePath,
      absPath: project.absPath
    })),
    runActions: (workspace.runActions ?? []).map((action) => ({
      ...action,
      default: action.id === workspace.defaultRunActionId
    })),
    docker: view.docker,
    pythonEnvironment: view.pythonEnvironment,
    pinnedEndpoints: workspace.pinnedEndpoints ?? [],
    lastScanAt: workspace.lastScanAt
  }
}

export function listWorkspaces(catalog: AgentCatalog, group?: string) {
  const needle = group?.trim().toLowerCase()
  return catalog.workspaces
    .filter((workspace) => {
      if (!needle) return true
      const names = (workspace.groupId ? [workspace.groupId] : []).map((id) => groupName(catalog, id).toLowerCase())
      const ids = (workspace.groupId ? [workspace.groupId] : []).map((id) => id.toLowerCase())
      return names.includes(needle) || ids.includes(needle)
    })
    .map((workspace) => summarizeWorkspace(catalog, workspace))
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\\/g, '/')
}

export function findWorkspace(catalog: AgentCatalog, query: string): WorkspaceRecord {
  const needle = normalizeQuery(query)
  if (!needle) throw new WorkspaceNotFoundError(query)

  const exactId = catalog.workspaces.filter((workspace) => workspace.id.toLowerCase() === needle)
  if (exactId.length === 1) return exactId[0]
  if (exactId.length > 1) {
    throw new AmbiguousWorkspaceError(query, exactId.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath
    })))
  }

  const exactPath = catalog.workspaces.filter((workspace) =>
    normalizeComparePath(workspace.rootPath) === normalizeComparePath(query)
  )
  if (exactPath.length === 1) return exactPath[0]

  const exactName = catalog.workspaces.filter((workspace) => workspace.name.toLowerCase() === needle)
  if (exactName.length === 1) return exactName[0]
  if (exactName.length > 1) {
    throw new AmbiguousWorkspaceError(query, exactName.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath
    })))
  }

  const partial = catalog.workspaces.filter((workspace) => {
    const id = workspace.id.toLowerCase()
    const name = workspace.name.toLowerCase()
    const path = normalizeComparePath(workspace.rootPath)
    return id.includes(needle) || name.includes(needle) || path.includes(needle)
  })
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new AmbiguousWorkspaceError(query, partial.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath
    })))
  }

  throw new WorkspaceNotFoundError(query)
}

/**
 * List every runnable command. `cwd` is where the command runs: in the main checkout, or in
 * `worktreePath` (an already-resolved checkout path, see resolveWorktree) when one is given.
 */
export function listWorkspaceCommands(workspace: WorkspaceRecord, worktreePath?: string | null): AgentCommand[] {
  return commandList(workspace, worktreePath).groups.flatMap((group) => group.commands).map((command) => ({
    id: command.id, projectId: workspace.id, kind: command.kind,
    name: command.name, title: command.title, cwd: command.cwd, favorite: command.favorite,
    description: command.description, shellPreview: command.script
  }))
}

function commandAliases(command: AgentCommand, workspace: WorkspaceRecord) {
  const aliases = new Set<string>([
    command.id.toLowerCase(),
    command.name.toLowerCase(),
    command.title.toLowerCase()
  ])
  if (command.kind === 'script') {
    const project = workspace.projects.find((item) => command.id.includes(`::${item.id}::`))
    if (project) {
      aliases.add(`${project.name.toLowerCase()}/${command.name.toLowerCase()}`)
      aliases.add(`${project.name.toLowerCase()}:${command.name.toLowerCase()}`)
      aliases.add(`${project.name.toLowerCase()}::${command.name.toLowerCase()}`)
    }
  }
  if (command.kind === 'run-action') {
    const action = (workspace.runActions ?? []).find((item) => runActionCommandId(workspace.id, item.id) === command.id)
    if (action) aliases.add(action.id.toLowerCase())
  }
  return aliases
}

export function findCommands(workspace: WorkspaceRecord, query: string): AgentCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const commands = listWorkspaceCommands(workspace)
  const exactId = commands.filter((command) => command.id.toLowerCase() === needle)
  if (exactId.length > 0) return exactId

  const aliased = commands.filter((command) => commandAliases(command, workspace).has(needle))
  if (aliased.length > 0) return aliased

  return commands.filter((command) => command.id.toLowerCase().endsWith(`::${needle}`))
}

/** Match a worktree by checkout path or branch name; never fall back to the main checkout. */
export function resolveWorktree(workspace: WorkspaceRecord, query: string) {
  return resolveRunWorktreePath(workspace, query)
}

/** listWorkspaceCommands for a worktree given by path or branch name (as typed by a user or agent). */
export function listWorkspaceCommandsIn(workspace: WorkspaceRecord, worktree?: string | null) {
  return listWorkspaceCommands(workspace, worktree?.trim() ? resolveWorktree(workspace, worktree) : null)
}

export function resolveRunnable(
  catalog: AgentCatalog,
  input: { project?: string; command: string; worktree?: string | null }
): { workspace: WorkspaceRecord; command: AgentCommand; plan: CommandRunPlan } {
  const commandQuery = input.command.trim()
  if (!commandQuery) throw new CommandNotFoundError(input.command)

  let workspace: WorkspaceRecord | null = input.project ? findWorkspace(catalog, input.project) : null
  if (!workspace && commandQuery.includes('::')) {
    workspace = catalog.workspaces.find((item) =>
      listWorkspaceCommands(item).some((command) => command.id === commandQuery)
    ) ?? null
  }
  if (!workspace) {
    throw new CommandNotFoundError(
      input.project
        ? commandQuery
        : `${commandQuery} (pass a workspace with --project, or a full command id)`
    )
  }

  const matches = findCommands(workspace, commandQuery)
  if (matches.length === 0) throw new CommandNotFoundError(commandQuery)
  if (matches.length > 1) throw new AmbiguousCommandError(commandQuery, matches)

  const command = matches[0]
  const worktree = input.worktree?.trim() ? resolveWorktree(workspace, input.worktree) : null
  const plan = resolveRunPlan(workspace, command.id, worktree)

  if (!plan) throw new CommandNotFoundError(commandQuery)
  return { workspace, command, plan }
}
