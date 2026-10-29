import { existsSync } from 'node:fs'
import type { WorktreeWorkspace } from '@shared/worktreeExecution'
import { listWorkspaceWorktrees, resolveWorktreePath, WorktreeNotFoundError } from '@shared/worktreeExecution'

/** resolveWorktreePath, plus a check that a requested worktree still exists on disk. */
export function resolveRunWorktreePath(workspace: WorktreeWorkspace, worktreePath?: string | null) {
  const path = resolveWorktreePath(workspace, worktreePath)
  if (worktreePath?.trim() && !existsSync(path)) {
    throw new WorktreeNotFoundError(worktreePath, listWorkspaceWorktrees(workspace), 'missing')
  }
  return path
}
