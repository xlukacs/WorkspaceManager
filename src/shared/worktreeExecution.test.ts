import { describe, expect, it } from 'vitest'
import type { LegacyWorkspaceRecord } from '@shared/types'
import {
  listWorkspaceWorktrees,
  normalizeComparePath,
  remapPathToWorktree,
  remapRunPlanToWorktree,
  resolveSelectedWorktreePath,
  resolveWorktreePath,
  worktreeLabel,
  WorktreeNotFoundError
} from '@shared/worktreeExecution'

const workspace: LegacyWorkspaceRecord = {
  id: 'p1',
  name: 'demo',
  nameOverride: null,
  order: 0,
  rootPath: 'C:/repos/demo',
  groupIds: [],
  packageManager: 'pnpm',
  isMonorepo: true,
  rootScripts: { dev: 'vite' },
  workspacePackages: [
    {
      id: 'w1',
      name: 'web',
      relativePath: 'apps/web',
      absPath: 'C:/repos/demo/apps/web',
      scripts: { dev: 'vite' }
    }
  ],
  docker: null,
  pythonEnvironment: null,
  commandChains: {},
  favoriteCommandIds: [],
  lastScanAt: Date.now(),
  quickLinks: [],
  gitSummary: { branch: 'main', isDirty: false, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, lastCommitSubject: null, lastCommitRelative: null, lastCommitTimestamp: null },
  gitWorktrees: [
    {
      path: 'C:/repos/demo',
      branch: 'main',
      head: 'abc',
      isMain: true,
      isBare: false,
      isLocked: false
    },
    {
      path: 'C:/repos/demo/.worktrees/feature-auth',
      branch: 'feature/auth',
      head: 'def',
      isMain: false,
      isBare: false,
      isLocked: false
    }
  ],
  gitWorktreesRoot: 'C:/repos/demo/.worktrees'
}

describe('worktreeExecution', () => {
  it('lists configured worktrees', () => {
    expect(listWorkspaceWorktrees(workspace)).toHaveLength(2)
  })

  it('resolves worktree paths by checkout location', () => {
    expect(resolveWorktreePath(workspace, 'C:/repos/demo/.worktrees/feature-auth')).toBe(
      'C:/repos/demo/.worktrees/feature-auth'
    )
  })

  it('uses the main checkout only when no worktree is requested', () => {
    expect(resolveWorktreePath(workspace)).toBe('C:/repos/demo')
    expect(resolveWorktreePath(workspace, null)).toBe('C:/repos/demo')
    expect(resolveWorktreePath(workspace, 'feature/auth')).toBe('C:/repos/demo/.worktrees/feature-auth')
  })

  it('rejects unknown or missing worktrees instead of falling back to the main checkout', () => {
    expect(() => resolveWorktreePath(workspace, 'C:/repos/demo/.worktrees/deleted')).toThrow(WorktreeNotFoundError)
    const withMissing: LegacyWorkspaceRecord = {
      ...workspace,
      gitWorktrees: [...workspace.gitWorktrees, {
        path: 'C:/repos/demo/.worktrees/pruned',
        branch: 'pruned',
        head: null,
        isMain: false,
        isBare: false,
        isLocked: false,
        isMissing: true
      }]
    }
    expect(() => resolveWorktreePath(withMissing, 'C:/repos/demo/.worktrees/pruned')).toThrow('missing on disk')
  })

  it('falls back to the main checkout for a stale UI selection', () => {
    expect(resolveSelectedWorktreePath(workspace, 'C:/repos/demo/.worktrees/deleted')).toBe('C:/repos/demo')
    expect(resolveSelectedWorktreePath(workspace, 'C:/repos/demo/.worktrees/feature-auth')).toBe(
      'C:/repos/demo/.worktrees/feature-auth'
    )
  })

  it('remaps project and workspace paths into a worktree checkout', () => {
    const worktreePath = 'C:/repos/demo/.worktrees/feature-auth'
    expect(
      normalizeComparePath(remapPathToWorktree(workspace.rootPath, worktreePath, workspace.rootPath))
    ).toBe(normalizeComparePath(worktreePath))
    expect(
      normalizeComparePath(
        remapPathToWorktree(workspace.rootPath, worktreePath, 'C:/repos/demo/apps/web')
      )
    ).toBe(normalizeComparePath(`${worktreePath}/apps/web`))
  })

  it('remaps command run plans', () => {
    const remapped = remapRunPlanToWorktree(workspace, 'C:/repos/demo/.worktrees/feature-auth', {
      kind: 'single',
      commandId: 'cmd',
      title: 'Dev',
      shellLine: 'pnpm run dev',
      steps: [
        {
          commandId: 'cmd',
          title: 'Dev',
          cwd: 'C:/repos/demo',
          shellLine: 'pnpm run dev',
          pythonEnvironment: null
        }
      ]
    })

    expect(normalizeComparePath(remapped.steps[0]?.cwd ?? '')).toBe(
      normalizeComparePath('C:/repos/demo/.worktrees/feature-auth')
    )
  })

  it('labels worktrees by branch name', () => {
    expect(worktreeLabel(workspace.gitWorktrees[1]!)).toBe('feature/auth')
  })
})
