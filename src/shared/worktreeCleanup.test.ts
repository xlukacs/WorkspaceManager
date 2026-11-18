import { describe, expect, it } from 'vitest'
import type { GitWorktree } from '@shared/types'
import {
  applyWorktreeCleanupProgress,
  classifyWorktreeForCleanup,
  estimateWorktreeCleanupRemainingMs,
  formatWorktreeCleanupEta,
  startWorktreeCleanupJob,
  selectWorktreesForCleanup,
  worktreeCleanupCutoffAt,
  worktreeRemoveBlockReason
} from '@shared/worktreeCleanup'

function worktree(overrides: Partial<GitWorktree> = {}): GitWorktree {
  return {
    path: '/repos/demo/.worktrees/feature',
    branch: 'feature',
    head: 'abc',
    isMain: false,
    isBare: false,
    isLocked: false,
    isDirty: false,
    isMissing: false,
    lastActivityAt: 1_000,
    lastActivityRelative: '10d ago',
    ...overrides
  }
}

const now = 1_000 + 10 * 24 * 60 * 60

describe('worktreeCleanup', () => {
  it('keeps main, locked, protected, dirty, and recent checkouts', () => {
    const options = { maxAgeDays: 7, now, protectPaths: ['/repos/demo/.worktrees/active'] }

    expect(classifyWorktreeForCleanup(worktree({ isMain: true, path: '/repos/demo' }), options).reason).toBe('main')
    expect(classifyWorktreeForCleanup(worktree({ isLocked: true }), options).reason).toBe('locked')
    expect(classifyWorktreeForCleanup(worktree({ isDirty: true }), options).reason).toBe('dirty')
    expect(classifyWorktreeForCleanup(worktree({ lastActivityAt: now - 60 }), options).reason).toBe('too-new')
    expect(
      classifyWorktreeForCleanup(worktree({ path: '/repos/demo/.worktrees/active' }), options).reason
    ).toBe('protected')
  })

  it('selects idle and missing checkouts', () => {
    const selected = selectWorktreesForCleanup(
      [
        worktree({ path: '/repos/demo', isMain: true, lastActivityAt: 1 }),
        worktree({ path: '/repos/demo/.worktrees/old', lastActivityAt: 1 }),
        worktree({ path: '/repos/demo/.worktrees/gone', isMissing: true, lastActivityAt: null }),
        worktree({ path: '/repos/demo/.worktrees/fresh', lastActivityAt: now })
      ],
      { maxAgeDays: 7, now }
    )

    expect(selected.map((entry) => entry.worktree.path)).toEqual([
      '/repos/demo/.worktrees/old',
      '/repos/demo/.worktrees/gone'
    ])
    expect(selected[1]?.reason).toBe('missing')
  })

  it('includes dirty checkouts only when asked', () => {
    const dirty = worktree({ isDirty: true, lastActivityAt: 1 })
    expect(classifyWorktreeForCleanup(dirty, { maxAgeDays: 7, now }).eligible).toBe(false)
    expect(classifyWorktreeForCleanup(dirty, { maxAgeDays: 7, now, includeDirty: true }).eligible).toBe(true)
  })

  it('computes a 7 day cutoff', () => {
    expect(worktreeCleanupCutoffAt(7, 700_000)).toBe(700_000 - 7 * 24 * 60 * 60)
  })

  it('blocks removing the main or dirty checkout from a row action', () => {
    expect(worktreeRemoveBlockReason(worktree({ isMain: true }))).toMatch(/main/i)
    expect(worktreeRemoveBlockReason(worktree({ isDirty: true }))).toMatch(/uncommitted/i)
    expect(worktreeRemoveBlockReason(worktree({ isDirty: true }), undefined, { allowDirty: true })).toBeNull()
    expect(worktreeRemoveBlockReason(worktree(), ['/repos/demo/.worktrees/feature'])).toMatch(/active workspace/i)
    expect(worktreeRemoveBlockReason(worktree())).toBeNull()
  })
})

describe('worktree cleanup progress', () => {
  const update = (completed: number, total = 10) => ({
    total,
    completed,
    removedPaths: [],
    errors: [],
    activePaths: []
  })

  it('waits for one removal before estimating', () => {
    let job = startWorktreeCleanupJob('ws', 10, 0)
    expect(estimateWorktreeCleanupRemainingMs(job, 500)).toBeNull()
    job = applyWorktreeCleanupProgress(job, 'ws', update(0), 1_000)
    expect(job.removalStartedAt).toBe(1_000)
    expect(estimateWorktreeCleanupRemainingMs(job, 5_000)).toBeNull()
  })

  it('estimates from the removal pace and counts down between removals', () => {
    let job = applyWorktreeCleanupProgress(startWorktreeCleanupJob('ws', 10, 0), 'ws', update(0), 1_000)
    job = applyWorktreeCleanupProgress(job, 'ws', update(2), 5_000)
    // 2s per removal, 8 left.
    expect(estimateWorktreeCleanupRemainingMs(job, 5_000)).toBe(16_000)
    expect(estimateWorktreeCleanupRemainingMs(job, 8_000)).toBe(13_000)
    expect(estimateWorktreeCleanupRemainingMs(job, 60_000)).toBe(0)
  })

  it('joins a run in progress and times only the removals it sees', () => {
    let job = applyWorktreeCleanupProgress(undefined, 'ws', update(3, 10), 2_000)
    expect(job).toMatchObject({ workspaceId: 'ws', status: 'running', total: 10, completed: 3 })
    expect(estimateWorktreeCleanupRemainingMs(job, 2_000)).toBeNull()
    job = applyWorktreeCleanupProgress(job, 'ws', update(4, 10), 5_000)
    // One removal seen, 3s each, 6 left.
    expect(estimateWorktreeCleanupRemainingMs(job, 5_000)).toBe(18_000)
  })

  it('formats the time left', () => {
    expect(formatWorktreeCleanupEta(null)).toMatch(/estimating/i)
    expect(formatWorktreeCleanupEta(2_000)).toBe('Almost done')
    expect(formatWorktreeCleanupEta(42_000)).toBe('About 42s left')
    expect(formatWorktreeCleanupEta(125_000)).toBe('About 2m 5s left')
    expect(formatWorktreeCleanupEta(120_000)).toBe('About 2m left')
    expect(formatWorktreeCleanupEta(3_900_000)).toBe('About 1h 5m left')
  })
})
