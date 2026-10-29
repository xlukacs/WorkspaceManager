import { existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { platform } from 'node:os'
import { rankScriptName } from '@shared/commandRanking'
import { joinPaths } from '@shared/pathUtils'
import { runActionCommandId } from '@shared/runActions'
import { normalizeComparePath } from '@shared/worktreeExecution'
import { projectPythonEnvironment, rootProject, workspaceFromLegacy } from '@shared/workspaceModel'
import type { CommandDescriptor, CommandKind, CommandExecutionPlan, CommandRunPlan, DetectedProject, LegacyWorkspaceRecord, PythonEnvironment, WorkspaceRecord } from '@shared/types'
import { resolveRunWorktreePath } from './runWorktree'

export interface WorkspaceCommand extends CommandDescriptor {
  kind: CommandKind
  description: string
  synthetic?: 'node-install' | 'python-install'
}

const REQUIREMENTS = ['requirements.txt', 'requirements-dev.txt', 'requirements.in']
function installSource(path: string) {
  if (REQUIREMENTS.some((file) => existsSync(join(path, file)))) return 'requirements' as const
  return existsSync(join(path, 'pyproject.toml')) ? 'pyproject' as const : null
}

/** v11 callers and stores awaiting their background scan retain root installer IDs. */
export function legacyCommandWorkspace(legacy: LegacyWorkspaceRecord): WorkspaceRecord {
  const workspace = workspaceFromLegacy(legacy, legacy.groupIds[0] ?? null)
  for (const project of workspace.projects) {
    const previous = legacy.workspacePackages.find((entry) => entry.id === project.id)
    if (previous?.source) project.source = previous.source
    if (previous?.packageManager) project.packageManager = previous.packageManager
  }
  return hydrateRootInstaller(workspace)
}

function hydrateRootInstaller(workspace: WorkspaceRecord): WorkspaceRecord {
  const root = rootProject(workspace)
  if (!root || root.python?.installSource) return workspace
  const source = installSource(workspace.rootPath)
  if (!source) return workspace
  return { ...workspace, projects: workspace.projects.map((project) => project.id !== root.id ? project : ({
    ...project, capabilities: [...new Set([...project.capabilities, 'python' as const])],
    python: { venvRelativePath: project.python?.venvRelativePath ?? null, installSource: source }
  })) }
}

function quoted(value: string) { return /[\s"$`]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value }
function pythonEnvironment(workspace: WorkspaceRecord, project: DetectedProject, checkout: string) {
  return projectPythonEnvironment(workspace, {
    ...project, python: { installSource: project.python?.installSource ?? null, venvRelativePath: project.python?.venvRelativePath ?? '.venv' }
  }, checkout, platform() === 'win32')!
}
function pythonInstallLine(workspace: WorkspaceRecord, project: DetectedProject) {
  const mainPath = joinPaths(workspace.rootPath, project.relativePath)
  const requirements = REQUIREMENTS.find((name) => existsSync(join(mainPath, name))) ?? 'requirements.txt'
  return `python -m pip install ${project.python?.installSource === 'requirements' ? `-r ${quoted(requirements)}` : '-e .'}`
}

function projectConfigPath(workspace: WorkspaceRecord, project: DetectedProject, value: string) {
  const root = joinPaths(workspace.rootPath, project.relativePath).replaceAll('\\', '/').replace(/\/$/, '')
  const path = value.replaceAll('\\', '/')
  return normalizeComparePath(path).startsWith(`${normalizeComparePath(root)}/`) ? path.slice(root.length + 1) : value
}

function commandIndex(input: WorkspaceRecord, checkout = input.rootPath) {
  const workspace = hydrateRootInstaller(input)
  const commands: WorkspaceCommand[] = []
  for (const project of workspace.projects) {
    const root = project.id === 'root'
    const prefix = root ? workspace.id : `${workspace.id}::${project.id}`
    const cwd = joinPaths(checkout, project.relativePath)
    const add = (key: string, name: string, script: string, kind: WorkspaceCommand['kind'], rank: number, synthetic?: WorkspaceCommand['synthetic'], description = script) => {
      const id = `${prefix}::${key}`
      commands.push({
        id, workspaceId: workspace.id, projectId: project.id, projectName: project.name,
        scope: root ? 'root' : 'project', kind, name, script, description, synthetic,
        title: root ? name : `${project.name} · ${name}`, cwd,
        packageManager: project.packageManager ?? 'unknown', rank, favorite: workspace.favoriteCommandIds.includes(id),
        prerequisiteCommandIds: [], prerequisiteTitles: [], hasChain: false
      })
    }
    for (const [name, script] of Object.entries(project.scripts)) {
      add(`${root ? 'root::' : ''}${name}`, name, script, 'script', rankScriptName(name))
    }
    if (project.capabilities.includes('node') && !project.scripts.install) {
      const manager = project.packageManager && project.packageManager !== 'unknown' ? project.packageManager : 'npm'
      add('synthetic::node-install', 'install', `${manager} install`, 'script', 72, 'node-install')
    }
    if (project.python?.installSource && !project.scripts['python:install']) {
      add('synthetic::python-install', 'python:install', pythonInstallLine(workspace, project), 'script', 68, 'python-install')
    }
    const docker = project.docker
    if (docker?.composeFile) {
      const base = `docker compose -f ${quoted(projectConfigPath(workspace, project, docker.composeFile))}`
      for (const [key, name, args, rank, description] of [
        ['compose-up', 'Compose Up', 'up', 100, 'Start the stack in attached mode'],
        ['compose-build', 'Compose Build', 'build', 86, 'Build compose services'],
        ['compose-logs', 'Compose Logs', 'logs -f', 82, 'Stream logs for all services'],
        ['compose-ps', 'Compose Ps', 'ps', 60, 'List service state'],
        ['compose-down', 'Compose Down', 'down', 42, 'Stop and remove the stack']
      ] as const) add(`docker::${key}`, name, `${base} ${args}`, 'docker', rank, undefined, description)
      for (const service of docker.services) {
        add(`docker::service-up-${service}`, `${service} Up`, `${base} up ${service}`, 'docker', 88, undefined, `Start ${service} only`)
        add(`docker::service-logs-${service}`, `${service} Logs`, `${base} logs -f ${service}`, 'docker', 76, undefined, `Stream logs for ${service}`)
      }
    }
    if (docker?.dockerfile) {
      const image = basename(joinPaths(workspace.rootPath, project.relativePath)).toLowerCase().replace(/[^a-z0-9-_]+/g, '-')
      add('docker::docker-build', 'Build Image', `docker build -t ${image}:local -f ${quoted(projectConfigPath(workspace, project, docker.dockerfile))} .`, 'docker', 84, undefined, `Build ${image} from Dockerfile`)
    }
  }
  const root = rootProject(workspace)
  for (const action of workspace.runActions ?? []) {
    const id = runActionCommandId(workspace.id, action.id)
    commands.push({
      id, workspaceId: workspace.id, projectId: root?.id, projectName: root?.name,
      scope: 'root', kind: 'run-action', name: action.description, title: action.description,
      cwd: checkout, script: action.command, description: action.command, rank: 110,
      packageManager: root?.packageManager ?? 'unknown', favorite: workspace.defaultRunActionId === action.id,
      prerequisiteCommandIds: [], prerequisiteTitles: [], hasChain: false
    })
  }
  return { workspace, index: new Map(commands.map((command) => [command.id, command])) }
}

export function listWorkspaceCommands(workspace: WorkspaceRecord, worktreePath?: string | null) {
  const checkout = resolveRunWorktreePath(workspace, worktreePath)
  const { workspace: resolvedWorkspace, index } = commandIndex(workspace, checkout)
  const commands = [...index.values()].map((command) => {
    const ids = (workspace.commandChains[command.id] ?? []).filter((id) => index.has(id))
    return { ...command, prerequisiteCommandIds: ids, prerequisiteTitles: ids.map((id) => index.get(id)!.title), hasChain: ids.length > 0 }
  })
  const groups = resolvedWorkspace.projects.map((project) => ({
    key: project.id, title: project.name, projectId: project.id, relativePath: project.relativePath,
    capabilities: project.capabilities,
    commands: commands.filter((command) => command.projectId === project.id)
      .sort((left, right) => right.rank - left.rank || left.name.localeCompare(right.name))
  })).filter((group) => group.commands.length > 0)
  return { favorites: commands.filter((command) => command.favorite), groups }
}

function expand(index: Map<string, WorkspaceCommand>, chains: Record<string, string[]>, id: string) {
  const visiting = new Set<string>()
  const seen = new Set<string>()
  const ordered: WorkspaceCommand[] = []
  function visit(next: string) {
    if (visiting.has(next)) throw new Error('Command prerequisite cycle detected.')
    if (seen.has(next)) return
    const command = index.get(next)
    if (!command) throw new Error(`Unknown prerequisite command: ${next}`)
    visiting.add(next)
    for (const prerequisite of chains[next] ?? []) visit(prerequisite)
    visiting.delete(next)
    seen.add(next)
    ordered.push(command)
  }
  visit(id)
  return ordered
}

export function validateWorkspaceCommandChain(workspace: WorkspaceRecord, commandId: string, prerequisites: string[]) {
  const { index } = commandIndex(workspace)
  if (!index.has(commandId)) throw new Error(`Unknown command: ${commandId}`)
  const ids = [...new Set(prerequisites)]
  if (ids.includes(commandId)) throw new Error('A command cannot depend on itself.')
  expand(index, { ...workspace.commandChains, [commandId]: ids }, commandId)
  return ids
}

export function resolveRunPlan(input: WorkspaceRecord, commandId: string, worktreePath?: string | null): CommandRunPlan | null {
  const checkout = resolveRunWorktreePath(input, worktreePath)
  const { workspace, index } = commandIndex(input, checkout)
  const target = index.get(commandId)
  if (!target) return null
  const ordered = expand(index, workspace.commandChains, commandId)
  const environments = new Map<string, PythonEnvironment>()
  const steps = ordered.flatMap((command): CommandExecutionPlan[] => {
    const project = workspace.projects.find((project) => project.id === command.projectId) ?? rootProject(workspace)
    if (!project) throw new Error(`Project not found for command: ${command.id}`)
    const cwd = joinPaths(checkout, project.relativePath)
    if (worktreePath) {
      let directory = false
      try { directory = statSync(cwd).isDirectory() } catch { /* reported below */ }
      if (!directory) throw new Error(`Project folder "${project.relativePath || '.'}" is missing in checkout: ${checkout}`)
    }
    const environment = projectPythonEnvironment(workspace, project, checkout, platform() === 'win32') ?? environments.get(project.id) ?? null
    const execution = (shellLine: string, python = environment): CommandExecutionPlan => ({ commandId: command.id, title: command.title, cwd, shellLine, pythonEnvironment: python })
    if (command.synthetic === 'python-install') {
      const python = pythonEnvironment(workspace, project, checkout)
      environments.set(project.id, python)
      const install = execution(pythonInstallLine(workspace, project), python)
      if (existsSync(python.pythonPath)) return [install]
      return [{ ...execution(`${platform() === 'win32' ? 'py -3' : 'python3'} -m venv ${quoted(project.python?.venvRelativePath ?? '.venv')}`, null), commandId: `${command.id}::create-env`, title: 'Create .venv' }, install]
    }
    if (command.kind !== 'script' || command.synthetic === 'node-install') return [execution(command.script)]
    const manager = project.packageManager && project.packageManager !== 'unknown' ? project.packageManager : 'npm'
    return [execution(`${manager} run ${command.name}`)]
  })
  return {
    kind: steps.length > 1 ? 'chain' : 'single', commandId, title: target.title,
    shellLine: ordered.length > 1 ? steps.map((step) => step.title).join(' -> ') : steps.length > 1 ? target.script : steps[0]!.shellLine,
    steps
  }
}
