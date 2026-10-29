import type { CommandRunPlan, LegacyWorkspaceRecord } from '@shared/types'
import { normalizeComparePath, remapPythonEnvironment, resolveWorktreePath } from '@shared/worktreeExecution'

const RUN_ACTION_SCOPE = 'run-action'

export function runActionCommandId(workspaceId: string, actionId: string) {
  return `${workspaceId}::${RUN_ACTION_SCOPE}::${actionId}`
}

export function resolveRunActionPlan(
  workspace: LegacyWorkspaceRecord,
  actionIdOrCommandId: string,
  worktreePath?: string | null
): CommandRunPlan | null {
  const action = (workspace.runActions ?? []).find((candidate) =>
    candidate.id === actionIdOrCommandId || runActionCommandId(workspace.id, candidate.id) === actionIdOrCommandId
  )
  if (!action) return null

  const commandId = runActionCommandId(workspace.id, action.id)
  const cwd = resolveWorktreePath(workspace, worktreePath)
  const pythonEnvironment = normalizeComparePath(cwd) === normalizeComparePath(workspace.rootPath)
    ? workspace.pythonEnvironment
    : remapPythonEnvironment(workspace, cwd, workspace.pythonEnvironment)
  return {
    kind: 'single',
    commandId,
    title: action.description,
    shellLine: action.command,
    steps: [{
      commandId,
      title: action.description,
      cwd,
      shellLine: action.command,
      pythonEnvironment
    }]
  }
}
