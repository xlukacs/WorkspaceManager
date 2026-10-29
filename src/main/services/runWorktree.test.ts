import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LegacyWorkspaceRecord } from '@shared/types'
import { resolveRunWorktreePath } from '@main/services/runWorktree'

const roots: string[] = []

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'wsm-run-worktree-'))
  roots.push(root)
  const feature = join(root, 'feature')
  return {
    root,
    feature,
    project: {
      id: 'p1',
      rootPath: root,
      gitSummary: null,
      gitWorktrees: [
        { path: root, branch: 'main', head: null, isMain: true, isBare: false, isLocked: false },
        { path: feature, branch: 'feature', head: null, isMain: false, isBare: false, isLocked: false }
      ]
    } as unknown as LegacyWorkspaceRecord
  }
}

describe('resolveRunWorktreePath', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('rejects a known worktree whose checkout was deleted from disk', async () => {
    const { root, project: workspace } = await makeWorkspace()
    expect(resolveRunWorktreePath(workspace, null)).toBe(root)
    expect(resolveRunWorktreePath(workspace, root)).toBe(root)
    expect(() => resolveRunWorktreePath(workspace, 'feature')).toThrow('missing on disk')
  })
})
