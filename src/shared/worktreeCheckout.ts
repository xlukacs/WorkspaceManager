import type { GitWorktree } from '@shared/types'
import { normalizeComparePath, worktreeLabel } from '@shared/worktreeExecution'

export interface WorktreePriorityOptions {
  selectedPath?: string | null
  /** Checkouts that currently have running console sessions. */
  activePaths?: Iterable<string>
}

function activityOf(worktree: GitWorktree) {
  const value = worktree.lastActivityAt
  return value != null && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
}

function compareByActivity(left: GitWorktree, right: GitWorktree) {
  const activity = activityOf(right) - activityOf(left)
  if (activity !== 0 && !Number.isNaN(activity)) return activity
  return worktreeLabel(left).localeCompare(worktreeLabel(right))
}

/** Main checkout first, then most recently active, then alphabetical. */
export function sortWorktreesByActivity(worktrees: GitWorktree[]) {
  return [...worktrees].sort((left, right) => {
    if (left.isMain !== right.isMain) return left.isMain ? -1 : 1
    return compareByActivity(left, right)
  })
}

/**
 * Orders checkouts by how much they deserve a visible slot: the selected one, then those with
 * running consoles, then the main checkout, then the rest by most recent activity.
 */
export function prioritizeWorktrees(worktrees: GitWorktree[], options: WorktreePriorityOptions = {}) {
  const selectedKey = options.selectedPath ? normalizeComparePath(options.selectedPath) : null
  const activeKeys = new Set<string>()
  for (const path of options.activePaths ?? []) activeKeys.add(normalizeComparePath(path))

  const rank = (worktree: GitWorktree) => {
    const key = normalizeComparePath(worktree.path)
    if (key === selectedKey) return 0
    if (activeKeys.has(key)) return 1
    if (worktree.isMain) return 2
    return 3
  }

  return [...worktrees].sort((left, right) => rank(left) - rank(right) || compareByActivity(left, right))
}

/**
 * Picks which chips (given in priority order) fit on a single row. When not everything fits,
 * room is reserved for the overflow button and lower-priority chips may fill gaps left by wider
 * ones. The first chip is always kept. Returns the indexes of the chips to show.
 */
export function fitChipsInRow(chipWidths: number[], availableWidth: number, gap: number, overflowWidth: number) {
  const all = chipWidths.map((_, index) => index)
  const total = chipWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, chipWidths.length - 1)
  if (total <= availableWidth) return all

  const budget = availableWidth - overflowWidth
  const shown: number[] = []
  let used = 0
  chipWidths.forEach((width, index) => {
    const next = used + width + gap
    if (index === 0 || next <= budget) {
      shown.push(index)
      used = next
    }
  })
  return shown
}

/** Case-insensitive substring match on branch label and path; every whitespace-separated term must match. */
export function filterWorktrees(worktrees: GitWorktree[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return worktrees
  return worktrees.filter((worktree) => {
    const haystack = `${worktreeLabel(worktree)}\n${worktree.path}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
