import { describe, expect, it } from 'vitest'
import type { GitWorktree } from '@shared/types'
import {
  classifyWorktreeForCleanup,
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
