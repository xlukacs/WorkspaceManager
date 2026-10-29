import type { GitWorktree } from '@shared/types'
import { normalizeComparePath } from '@shared/worktreeExecution'

export const DEFAULT_WORKTREE_CLEANUP_MAX_AGE_DAYS = 7
export const WORKTREE_CLEANUP_AGE_OPTIONS = [3, 7, 14, 30] as const
export const WORKTREE_CLEANUP_SECONDS_PER_DAY = 60 * 60 * 24

export type WorktreeCleanupAgeDays = (typeof WORKTREE_CLEANUP_AGE_OPTIONS)[number]

export type WorktreeCleanupSkipReason =
  | 'main'
  | 'bare'
  | 'locked'
  | 'protected'
  | 'dirty'
  | 'too-new'
  | 'unknown-age'

export type WorktreeCleanupMatchReason = 'stale' | 'missing'

export interface WorktreeCleanupOptions {
  maxAgeDays: number
  now?: number
  protectPaths?: string[]
  includeDirty?: boolean
}

export interface WorktreeCleanupDecision {
  worktree: GitWorktree
  eligible: boolean
  reason: WorktreeCleanupSkipReason | WorktreeCleanupMatchReason
}

export function isWorktreeCleanupAgeDays(value: unknown): value is WorktreeCleanupAgeDays {
  return typeof value === 'number' && (WORKTREE_CLEANUP_AGE_OPTIONS as readonly number[]).includes(value)
}

export function normalizeWorktreeCleanupMaxAgeDays(value: unknown) {
  return isWorktreeCleanupAgeDays(value) ? value : DEFAULT_WORKTREE_CLEANUP_MAX_AGE_DAYS
}

export function worktreeCleanupCutoffAt(maxAgeDays: number, now = Math.floor(Date.now() / 1000)) {
  const days = Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays : DEFAULT_WORKTREE_CLEANUP_MAX_AGE_DAYS
  return now - Math.floor(days * WORKTREE_CLEANUP_SECONDS_PER_DAY)
}

function isProtectedWorktree(worktree: GitWorktree, protectPaths: string[] | undefined) {
  if (!protectPaths || protectPaths.length === 0) return false
  const worktreePath = normalizeComparePath(worktree.path)
  return protectPaths.some((path) => normalizeComparePath(path) === worktreePath)
}

export function classifyWorktreeForCleanup(
  worktree: GitWorktree,
  options: WorktreeCleanupOptions
): WorktreeCleanupDecision {
  if (worktree.isBare) return { worktree, eligible: false, reason: 'bare' }
  if (worktree.isMain) return { worktree, eligible: false, reason: 'main' }
  if (worktree.isLocked) return { worktree, eligible: false, reason: 'locked' }
  if (isProtectedWorktree(worktree, options.protectPaths)) {
    return { worktree, eligible: false, reason: 'protected' }
  }
  if (worktree.isMissing) return { worktree, eligible: true, reason: 'missing' }
  if (worktree.isDirty && !options.includeDirty) {
    return { worktree, eligible: false, reason: 'dirty' }
  }

  const activity = worktree.lastActivityAt
  if (activity == null || !Number.isFinite(activity)) {
    return { worktree, eligible: false, reason: 'unknown-age' }
  }

  if (activity > worktreeCleanupCutoffAt(options.maxAgeDays, options.now)) {
    return { worktree, eligible: false, reason: 'too-new' }
  }

  return { worktree, eligible: true, reason: 'stale' }
}

export function selectWorktreesForCleanup(worktrees: GitWorktree[], options: WorktreeCleanupOptions) {
  return worktrees
    .map((worktree) => classifyWorktreeForCleanup(worktree, options))
    .filter((decision) => decision.eligible)
}

export function worktreeCleanupReasonLabel(reason: WorktreeCleanupDecision['reason']) {
  switch (reason) {
    case 'main':
      return 'main checkout'
    case 'bare':
      return 'bare'
    case 'locked':
      return 'locked'
    case 'protected':
      return 'this workspace'
    case 'dirty':
      return 'uncommitted changes'
    case 'too-new':
      return 'newer than the cutoff'
    case 'unknown-age':
      return 'age unknown'
    case 'stale':
      return 'idle'
    case 'missing':
      return 'folder missing'
  }
}

export function worktreeRemoveBlockReason(
  worktree: GitWorktree,
  protectPaths?: string[],
  options?: { allowDirty?: boolean }
) {
  if (worktree.isBare) return 'Bare worktrees cannot be removed.'
  if (worktree.isMain) return 'The main checkout cannot be removed.'
  if (worktree.isLocked) return 'Locked worktrees cannot be removed.'
  if (isProtectedWorktree(worktree, protectPaths)) return 'The active workspace checkout cannot be removed.'
  if (worktree.isDirty && !options?.allowDirty) return 'This checkout has uncommitted changes.'
  return null
}
