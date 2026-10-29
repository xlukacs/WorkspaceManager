import { describe, expect, it } from 'vitest'
import type { GitWorktree } from '@shared/types'
import { filterWorktrees, fitChipsInRow, prioritizeWorktrees, sortWorktreesByActivity } from '@shared/worktreeCheckout'

function worktree(branch: string, lastActivityAt: number | null, isMain = false): GitWorktree {
  return {
    path: isMain ? '/repos/demo' : `/worktrees/demo/${branch.replace(/\//g, '-')}`,
    branch,
    head: null,
    isMain,
    isBare: false,
    isLocked: false,
    lastActivityAt
  }
}

const main = worktree('master', 100, true)
const fresh = worktree('t3code/fresh', 900)
const recent = worktree('t3code/recent', 800)
const older = worktree('review-77', 500)
const stale = worktree('t3code/stale', 10)
const unknown = worktree('t3code/unknown', null)
const all = [stale, unknown, older, main, recent, fresh]

const labels = (worktrees: GitWorktree[]) => worktrees.map((entry) => entry.branch)

describe('sortWorktreesByActivity', () => {
  it('puts main first, then newest activity, then unknown age', () => {
    expect(labels(sortWorktreesByActivity(all))).toEqual([
      'master',
      't3code/fresh',
      't3code/recent',
      'review-77',
      't3code/stale',
      't3code/unknown'
    ])
  })
})

describe('prioritizeWorktrees', () => {
  it('ranks selected, then running, then main, then recent activity', () => {
    const ordered = prioritizeWorktrees(all, {
      selectedPath: stale.path,
      activePaths: [older.path.toUpperCase()]
    })
    expect(labels(ordered)).toEqual([
      't3code/stale',
      'review-77',
      'master',
      't3code/fresh',
      't3code/recent',
      't3code/unknown'
    ])
  })

  it('falls back to activity order without selection or running consoles', () => {
    expect(labels(prioritizeWorktrees(all)).slice(0, 3)).toEqual(['master', 't3code/fresh', 't3code/recent'])
  })
})

describe('fitChipsInRow', () => {
  it('shows everything when it all fits, without reserving the overflow button', () => {
    expect(fitChipsInRow([100, 100, 100], 320, 10, 80)).toEqual([0, 1, 2])
  })

  it('reserves room for the overflow button when something is hidden', () => {
    // 100 + 10 + 100 + 10 + 80 = 300; a third chip would need 110 more.
    expect(fitChipsInRow([100, 100, 100, 100], 320, 10, 80)).toEqual([0, 1])
  })

  it('lets a narrower lower-priority chip fill the gap left by a wide one', () => {
    expect(fitChipsInRow([100, 200, 50], 300, 10, 80)).toEqual([0, 2])
  })

  it('always keeps the first chip even when nothing fits', () => {
    expect(fitChipsInRow([500, 50], 100, 10, 80)).toEqual([0])
  })

  it('handles an empty list', () => {
    expect(fitChipsInRow([], 100, 10, 80)).toEqual([])
  })
})

describe('filterWorktrees', () => {
  it('matches substrings case-insensitively', () => {
    expect(labels(filterWorktrees(all, 'RECENT'))).toEqual(['t3code/recent'])
  })

  it('requires every term to match', () => {
    expect(labels(filterWorktrees(all, 't3code st'))).toEqual(['t3code/stale'])
  })

  it('matches against the checkout path', () => {
    expect(labels(filterWorktrees(all, '/repos/'))).toEqual(['master'])
  })

  it('returns everything for an empty query', () => {
    expect(filterWorktrees(all, '   ')).toHaveLength(all.length)
  })
})
