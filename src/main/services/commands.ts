import type { CommandDescriptor, LegacyWorkspaceRecord } from '@shared/types'
import { legacyCommandWorkspace, listWorkspaceCommands, resolveRunPlan, validateWorkspaceCommandChain } from './workspaceCommands'

export { rankScriptName } from '@shared/commandRanking'

/** Compatibility adapters; the command index and planner live in workspaceCommands. */
export function listCommands(workspace: LegacyWorkspaceRecord) {
  const list = listWorkspaceCommands(legacyCommandWorkspace(workspace))
  const commands = list.groups.flatMap((group) => group.commands).filter((command) => command.kind === 'script')
  const sort = (left: CommandDescriptor, right: CommandDescriptor) => Number(right.favorite) - Number(left.favorite) || right.rank - left.rank || left.name.localeCompare(right.name)
  const root = commands.filter((command) => command.scope === 'root').sort(sort)
  const projects = commands.filter((command) => command.scope === 'project').sort(sort)
  return {
    favorites: commands.filter((command) => command.favorite).sort(sort),
    groups: [
      ...(root.length ? [{ key: 'root', title: 'Root Scripts', commands: root }] : []),
      ...(projects.length ? [{ key: 'workspaces', title: 'Project Scripts', commands: projects }] : [])
    ]
  }
}

export function validateCommandChain(workspace: LegacyWorkspaceRecord, commandId: string, prerequisites: string[]) {
  return validateWorkspaceCommandChain(legacyCommandWorkspace(workspace), commandId, prerequisites)
}

export function resolveCommandRunPlan(workspace: LegacyWorkspaceRecord, commandId: string, worktreePath?: string | null) {
  return resolveRunPlan(legacyCommandWorkspace(workspace), commandId, worktreePath)
}
