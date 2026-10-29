import type { LegacyWorkspaceRecord } from '@shared/types'
import { legacyCommandWorkspace, listWorkspaceCommands, resolveRunPlan, validateWorkspaceCommandChain } from './workspaceCommands'

export function listDockerCommands(workspace: LegacyWorkspaceRecord) {
  const commands = listWorkspaceCommands(legacyCommandWorkspace(workspace)).groups.flatMap((group) => group.commands)
    .filter((command) => command.kind === 'docker').map((command) => ({ ...command, shellLine: command.script }))
  const groups = [
    { key: 'compose', title: 'Compose', commands: commands.filter((command) => command.id.includes('::docker::compose-')) },
    { key: 'services', title: 'Services', commands: commands.filter((command) => command.id.includes('::docker::service-')) },
    { key: 'dockerfile', title: 'Dockerfile', commands: commands.filter((command) => command.id.endsWith('::docker::docker-build')) }
  ]
  return { groups: groups.filter((group) => group.commands.length).map((group) => ({ ...group, commands: group.commands.sort((left, right) => right.rank - left.rank || left.title.localeCompare(right.title)) })) }
}

export function resolveDockerCommandExecution(workspace: LegacyWorkspaceRecord, commandId: string) {
  return resolveRunPlan(legacyCommandWorkspace({ ...workspace, commandChains: {} }), commandId)?.steps[0] ?? null
}

export function validateDockerCommandChain(workspace: LegacyWorkspaceRecord, commandId: string, prerequisites: string[]) {
  const model = legacyCommandWorkspace(workspace)
  const ids = new Set(listWorkspaceCommands(model).groups.flatMap((group) => group.commands.map((command) => command.id)))
  for (const id of prerequisites) if (!ids.has(id)) throw new Error(`Unknown prerequisite docker command: ${id}`)
  return validateWorkspaceCommandChain(model, commandId, prerequisites)
}

export function resolveDockerRunPlan(workspace: LegacyWorkspaceRecord, commandId: string, worktreePath?: string | null) {
  return resolveRunPlan(legacyCommandWorkspace(workspace), commandId, worktreePath)
}
