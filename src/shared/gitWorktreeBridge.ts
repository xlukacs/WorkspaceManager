import type {
  CleanupGitWorktreesInput,
  CreateGitWorktreeInput,
  RemoveGitWorktreeInput
} from '@shared/types'

/** Encoded `workspaces.getDetails` keys — work with older preload scripts that lack dedicated git IPC. */
export const WORKSPACE_GET_DETAILS_CONVERT_WORKTREES_PREFIX = '__wm:convertWorktrees:'
export const WORKSPACE_GET_DETAILS_CREATE_WORKTREE_PREFIX = '__wm:createWorktree:'
export const WORKSPACE_GET_DETAILS_CLEANUP_WORKTREES_PREFIX = '__wm:cleanupWorktrees:'
export const WORKSPACE_GET_DETAILS_REMOVE_WORKTREE_PREFIX = '__wm:removeWorktree:'

export function workspaceGetDetailsConvertWorktreesKey(workspaceId: string) {
  return `${WORKSPACE_GET_DETAILS_CONVERT_WORKTREES_PREFIX}${workspaceId}`
}

export function workspaceGetDetailsCreateWorktreeKey(input: CreateGitWorktreeInput) {
  return `${WORKSPACE_GET_DETAILS_CREATE_WORKTREE_PREFIX}${JSON.stringify(input)}`
}

export function workspaceGetDetailsCleanupWorktreesKey(input: CleanupGitWorktreesInput) {
  return `${WORKSPACE_GET_DETAILS_CLEANUP_WORKTREES_PREFIX}${JSON.stringify(input)}`
}

export function workspaceGetDetailsRemoveWorktreeKey(input: RemoveGitWorktreeInput) {
  return `${WORKSPACE_GET_DETAILS_REMOVE_WORKTREE_PREFIX}${JSON.stringify(input)}`
}

function parseJsonPayload<T>(key: string, prefix: string): T | null {
  if (!key.startsWith(prefix)) return null
  try {
    return JSON.parse(key.slice(prefix.length)) as T
  } catch {
    return null
  }
}

export function parseWorkspaceGetDetailsCreateWorktreeKey(key: string): CreateGitWorktreeInput | null {
  return parseJsonPayload(key, WORKSPACE_GET_DETAILS_CREATE_WORKTREE_PREFIX)
}

export function parseWorkspaceGetDetailsCleanupWorktreesKey(key: string): CleanupGitWorktreesInput | null {
  return parseJsonPayload(key, WORKSPACE_GET_DETAILS_CLEANUP_WORKTREES_PREFIX)
}

export function parseWorkspaceGetDetailsRemoveWorktreeKey(key: string): RemoveGitWorktreeInput | null {
  return parseJsonPayload(key, WORKSPACE_GET_DETAILS_REMOVE_WORKTREE_PREFIX)
}
