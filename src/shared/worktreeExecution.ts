import type { CommandExecutionPlan, CommandRunPlan, GitWorktree, WorkspaceRecord, PythonEnvironment } from '@shared/types'
import { joinPaths, normalizePath } from '@shared/pathUtils'

export type WorktreeWorkspace = Pick<WorkspaceRecord, 'rootPath' | 'gitWorktrees' | 'gitSummary'>

export function normalizeComparePath(value: string) {
  return normalizePath(value).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

export function listWorkspaceWorktrees(workspace: WorktreeWorkspace): GitWorktree[] {
  const worktrees = (workspace.gitWorktrees ?? []).filter((worktree) => !worktree.isBare)
  if (worktrees.length > 0) return worktrees

  return [
    {
      path: workspace.rootPath,
      branch: workspace.gitSummary?.branch ?? null,
      head: null,
      isMain: true,
      isBare: false,
      isLocked: false,
      isDirty: workspace.gitSummary?.isDirty ?? false,
      isMissing: false,
      lastActivityAt: workspace.gitSummary?.lastCommitTimestamp ?? null,
      lastActivityRelative: workspace.gitSummary?.lastCommitRelative ?? null
    }
  ]
}

export function resolveMainWorktreePath(workspace: WorktreeWorkspace) {
  const worktrees = listWorkspaceWorktrees(workspace)
  const main = worktrees.find((worktree) => worktree.isMain) ?? worktrees[0]
  return main?.path ?? workspace.rootPath
}

export class WorktreeNotFoundError extends Error {
  constructor(
    query: string,
    public readonly worktrees: GitWorktree[],
    public readonly reason: 'unknown' | 'missing' = 'unknown'
  ) {
    super(
      reason === 'missing'
        ? `Worktree "${query}" is missing on disk. Restore it or pick another worktree.`
        : `Unknown worktree "${query}". Known worktrees:\n${worktrees.map((worktree) => `  ${worktree.branch ?? '(detached)'}  ${worktree.path}`).join('\n')}`
    )
    this.name = 'WorktreeNotFoundError'
  }
}

/** Match a known worktree by checkout path, then by branch name. */
export function findWorktree(workspace: WorktreeWorkspace, query: string) {
  const worktrees = listWorkspaceWorktrees(workspace)
  const target = normalizeComparePath(query)
  return worktrees.find((worktree) => normalizeComparePath(worktree.path) === target)
    ?? worktrees.find((worktree) => worktree.branch === query.trim())
    ?? null
}

/**
 * Where a command runs. No worktree requested means the main checkout. A requested worktree
 * (path or branch) must be one of the workspace's worktrees and not marked missing; there is no
 * fallback, so a stale selection fails instead of running in the wrong checkout.
 */
export function resolveWorktreePath(workspace: WorktreeWorkspace, worktreePath?: string | null) {
  if (!worktreePath?.trim()) return resolveMainWorktreePath(workspace)

  const match = findWorktree(workspace, worktreePath)
  if (!match) throw new WorktreeNotFoundError(worktreePath, listWorkspaceWorktrees(workspace))
  if (match.isMissing) throw new WorktreeNotFoundError(worktreePath, listWorkspaceWorktrees(workspace), 'missing')
  return match.path
}

/** The worktree a UI selection points at, falling back to the main checkout when it is stale. */
export function resolveSelectedWorktreePath(workspace: WorktreeWorkspace, worktreePath?: string | null) {
  if (!worktreePath) return resolveMainWorktreePath(workspace)

  const normalizedTarget = normalizeComparePath(worktreePath)
  const match = listWorkspaceWorktrees(workspace).find((worktree) => normalizeComparePath(worktree.path) === normalizedTarget)
  return match && !match.isMissing ? match.path : resolveMainWorktreePath(workspace)
}

export function worktreeLabel(worktree: GitWorktree) {
  if (worktree.branch) return worktree.branch
  const segments = normalizePath(worktree.path).split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? worktree.path
}

export function remapPathToWorktree(workspaceRootPath: string, worktreePath: string, targetPath: string) {
  const normalizedRoot = normalizePath(workspaceRootPath)
  const normalizedWorktree = normalizePath(worktreePath)
  const normalizedTarget = normalizePath(targetPath)

  if (normalizeComparePath(normalizedTarget) === normalizeComparePath(normalizedRoot)) {
    return normalizedWorktree
  }

  const rootPrefix = normalizedRoot.endsWith('\\') || normalizedRoot.endsWith('/')
    ? normalizedRoot
    : `${normalizedRoot}\\`
  const rootPrefixPosix = `${normalizedRoot}/`

  if (normalizedTarget.startsWith(rootPrefix) || normalizedTarget.startsWith(rootPrefixPosix)) {
    const suffix = normalizedTarget.slice(normalizedRoot.length).replace(/^[/\\]/, '')
    return suffix ? joinPaths(normalizedWorktree, suffix) : normalizedWorktree
  }

  return normalizedTarget
}

export function remapPythonEnvironment(
  workspace: WorktreeWorkspace,
  worktreePath: string,
  pythonEnvironment: PythonEnvironment | null
): PythonEnvironment | null {
  if (!pythonEnvironment) return null

  return {
    ...pythonEnvironment,
    id: remapPathToWorktree(workspace.rootPath, worktreePath, pythonEnvironment.id),
    rootPath: remapPathToWorktree(workspace.rootPath, worktreePath, pythonEnvironment.rootPath),
    scriptsPath: remapPathToWorktree(workspace.rootPath, worktreePath, pythonEnvironment.scriptsPath),
    pythonPath: remapPathToWorktree(workspace.rootPath, worktreePath, pythonEnvironment.pythonPath)
  }
}

export function remapExecutionPlanToWorktree(
  workspace: WorktreeWorkspace,
  worktreePath: string,
  step: CommandExecutionPlan
): CommandExecutionPlan {
  return {
    ...step,
    cwd: remapPathToWorktree(workspace.rootPath, worktreePath, step.cwd),
    pythonEnvironment: remapPythonEnvironment(workspace, worktreePath, step.pythonEnvironment)
  }
}

export function remapRunPlanToWorktree(
  workspace: WorktreeWorkspace,
  worktreePath: string,
  runPlan: CommandRunPlan
): CommandRunPlan {
  return {
    ...runPlan,
    steps: runPlan.steps.map((step) => remapExecutionPlanToWorktree(workspace, worktreePath, step))
  }
}

export function workspaceHasMultipleWorktrees(workspace: WorktreeWorkspace) {
  return listWorkspaceWorktrees(workspace).length > 1
}
