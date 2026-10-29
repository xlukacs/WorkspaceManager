import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupGitWorktrees,
  convertRepoToWorktrees,
  createGitWorktree,
  defaultGitWorktreesRoot,
  ensureGitignoreWorktreesEntry,
  listGitWorktrees,
  parseGitStatus,
  parseGitWorktreeList,
  removeGitWorktree,
  sanitizeBranchDirectoryName
} from '@main/services/git'

const execFileAsync = promisify(execFile)
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000

const tempRoots: string[] = []

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'workspace-manager-git-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    )
  )
})

describe('parseGitStatus', () => {
  it('parses clean branch and commit info', () => {
    const summary = parseGitStatus('## main...origin/main', 'ship it\n1700000000')
    expect(summary.branch).toBe('main')
    expect(summary.isDirty).toBe(false)
    expect(summary.lastCommitSubject).toBe('ship it')
    expect(summary.lastCommitRelative).toBeTruthy()
  })

  it('counts staged, unstaged, and untracked files', () => {
    const summary = parseGitStatus('## feat/test\nM  src/a.ts\n M src/b.ts\n?? src/c.ts')
    expect(summary.stagedCount).toBe(1)
    expect(summary.unstagedCount).toBe(1)
    expect(summary.untrackedCount).toBe(1)
    expect(summary.isDirty).toBe(true)
  })
})

describe('parseGitWorktreeList', () => {
  it('parses branches, bare, and locked worktrees', () => {
    const mainPath = normalize('C:/repos/demo')
    const featurePath = normalize('C:/repos/demo-feature')
    const worktrees = parseGitWorktreeList(
      [
        `worktree ${mainPath}`,
        'HEAD abc1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
        `worktree ${featurePath}`,
        'HEAD def2222222222222222222222222222222222222222',
        'branch refs/heads/feature/checkout',
        'locked reason',
        '',
        'worktree C:/repos/demo-bare',
        'bare'
      ].join('\n'),
      mainPath
    )

    expect(worktrees).toHaveLength(2)
    expect(worktrees[0]?.path).toBe(mainPath)
    expect(worktrees[0]?.branch).toBe('main')
    expect(worktrees[0]?.isMain).toBe(true)
    expect(worktrees[1]?.path).toBe(featurePath)
    expect(worktrees[1]?.branch).toBe('feature/checkout')
    expect(worktrees[1]?.isLocked).toBe(true)
  })
})

describe('sanitizeBranchDirectoryName', () => {
  it('normalizes branch names for checkout folders', () => {
    expect(sanitizeBranchDirectoryName('feature/checkout')).toBe('feature-checkout')
    expect(sanitizeBranchDirectoryName('refs/heads/main')).toBe('main')
  })
})

describe('defaultGitWorktreesRoot', () => {
  it('uses an in-repo .worktrees directory', () => {
    const root = normalize('C:/repos/demo')
    expect(defaultGitWorktreesRoot(root)).toBe(join(root, '.worktrees'))
  })
})

describe('ensureGitignoreWorktreesEntry', () => {
  it('appends .worktrees/ when missing', async () => {
    const root = await makeTempRoot()
    await writeFile(join(root, '.gitignore'), 'node_modules/\n')

    await ensureGitignoreWorktreesEntry(root)

    const content = await readFile(join(root, '.gitignore'), 'utf8')
    expect(content).toContain('.worktrees/')
    expect(gitignoreIncludesWorktrees(content)).toBe(true)
  })

  it('does not duplicate an existing entry', async () => {
    const root = await makeTempRoot()
    await writeFile(join(root, '.gitignore'), '.worktrees/\n')

    await ensureGitignoreWorktreesEntry(root)

    const content = await readFile(join(root, '.gitignore'), 'utf8')
    expect(content.match(/\.worktrees\/?/g)?.length).toBe(1)
  })
})

function gitignoreIncludesWorktrees(content: string) {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    return trimmed === '.worktrees' || trimmed === '.worktrees/'
  })
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  await execFileAsync('git', args, { cwd, env: env ? { ...process.env, ...env } : process.env })
}

async function initRepo() {
  const root = await makeTempRoot()
  try {
    await git(root, ['init', '-b', 'main'])
  } catch {
    await git(root, ['init'])
  }
  await git(root, ['config', 'user.email', 'wm@test.local'])
  await git(root, ['config', 'user.name', 'WM Test'])
  await git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

async function commitAll(root: string, message: string, date = new Date()) {
  const stamp = date.toISOString()
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', message], {
    GIT_AUTHOR_DATE: stamp,
    GIT_COMMITTER_DATE: stamp
  })
}

async function stampWorktreeOld(worktreePath: string, when: Date) {
  const unix = when.getTime() / 1000
  await utimes(worktreePath, unix, unix)
  await utimes(join(worktreePath, '.git'), unix, unix).catch(() => undefined)
  const { stdout } = await execFileAsync('git', ['rev-parse', '--absolute-git-dir'], { cwd: worktreePath })
  const gitDir = stdout.trim()
  if (!gitDir) return
  await utimes(join(gitDir, 'HEAD'), unix, unix).catch(() => undefined)
}

describe('cleanupGitWorktrees', () => {
  it('removes idle linked checkouts and keeps a fresh checkout of an old commit', async () => {
    const root = await initRepo()
    const old = new Date(Date.now() - TEN_DAYS_MS)
    await writeFile(join(root, 'README.md'), 'hello\n')
    await commitAll(root, 'init', old)

    const worktreesRoot = await convertRepoToWorktrees(root)
    const stalePath = await createGitWorktree(root, {
      worktreesRoot,
      branch: 'stale-branch',
      createBranch: true
    })
    const freshPath = await createGitWorktree(root, {
      worktreesRoot,
      branch: 'fresh-branch',
      createBranch: true
    })
    await stampWorktreeOld(stalePath, old)

    const result = await cleanupGitWorktrees(root, { maxAgeDays: 7, protectPaths: [root] })
    const remaining = await listGitWorktrees(root, { enrich: false })

    expect(result.removedPaths).toContain(normalize(stalePath))
    expect(result.removedPaths).not.toContain(normalize(freshPath))
    expect(remaining.map((worktree) => worktree.path)).toContain(normalize(freshPath))
    expect(remaining.map((worktree) => worktree.path)).not.toContain(normalize(stalePath))
  })

  it('does not remove a dirty idle checkout unless forced', async () => {
    const root = await initRepo()
    const old = new Date(Date.now() - TEN_DAYS_MS)
    await writeFile(join(root, 'README.md'), 'hello\n')
    await commitAll(root, 'init', old)

    const worktreesRoot = await convertRepoToWorktrees(root)
    const dirtyPath = await createGitWorktree(root, {
      worktreesRoot,
      branch: 'dirty-branch',
      createBranch: true
    })
    await writeFile(join(dirtyPath, 'scratch.txt'), 'wip\n')
    await stampWorktreeOld(dirtyPath, old)

    const kept = await cleanupGitWorktrees(root, { maxAgeDays: 7, protectPaths: [root] })
    expect(kept.removedPaths).toHaveLength(0)

    const forced = await cleanupGitWorktrees(root, {
      maxAgeDays: 7,
      protectPaths: [root],
      includeDirty: true
    })
    expect(forced.removedPaths).toContain(normalize(dirtyPath))
  })

  it('refuses to remove the main checkout', async () => {
    const root = await initRepo()
    await writeFile(join(root, 'README.md'), 'hello\n')
    await commitAll(root, 'init')

    await expect(removeGitWorktree(root, root)).rejects.toThrow(/main/i)
  })
})
