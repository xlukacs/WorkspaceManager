import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { GitSummary, GitWorktree } from '@shared/types'
import {
  classifyWorktreeForCleanup,
  type WorktreeCleanupSkipReason,
  worktreeRemoveBlockReason
} from '@shared/worktreeCleanup'
import { normalizeComparePath } from '@shared/worktreeExecution'

const execFileAsync = promisify(execFile)
const WORKTREES_GITIGNORE_ENTRY = '.worktrees/'

function relativeTime(timestampSeconds: number) {
  const deltaSeconds = Math.max(1, Math.floor(Date.now() / 1000) - timestampSeconds)
  const units = [
    { label: 'y', value: 60 * 60 * 24 * 365 },
    { label: 'mo', value: 60 * 60 * 24 * 30 },
    { label: 'd', value: 60 * 60 * 24 },
    { label: 'h', value: 60 * 60 },
    { label: 'm', value: 60 }
  ]

  for (const unit of units) {
    if (deltaSeconds >= unit.value) {
      return `${Math.floor(deltaSeconds / unit.value)}${unit.label} ago`
    }
  }

  return `${deltaSeconds}s ago`
}

export function parseGitStatus(statusOutput: string, commitOutput?: string): GitSummary {
  const lines = statusOutput.split(/\r?\n/).filter(Boolean)
  let branch: string | null = null
  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0

  for (const line of lines) {
    if (line.startsWith('## ')) {
      branch = line.slice(3).split('...')[0] || null
      continue
    }

    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') {
      untrackedCount += 1
      continue
    }
    if (x && x !== ' ') stagedCount += 1
    if (y && y !== ' ') unstagedCount += 1
  }

  let lastCommitSubject: string | null = null
  let lastCommitTimestamp: number | null = null
  let lastCommitRelative: string | null = null

  if (commitOutput) {
    const [subject, timestampRaw] = commitOutput.split(/\r?\n/)
    const timestamp = Number.parseInt(timestampRaw ?? '', 10)
    lastCommitSubject = subject || null
    lastCommitTimestamp = Number.isFinite(timestamp) ? timestamp : null
    lastCommitRelative = lastCommitTimestamp ? relativeTime(lastCommitTimestamp) : null
  }

  return {
    branch,
    isDirty: stagedCount + unstagedCount + untrackedCount > 0,
    stagedCount,
    unstagedCount,
    untrackedCount,
    lastCommitSubject,
    lastCommitRelative,
    lastCommitTimestamp
  }
}

export async function getGitSummary(rootPath: string) {
  try {
    const [{ stdout: statusOutput }, { stdout: commitOutput }] = await Promise.all([
      execFileAsync('git', ['status', '--short', '--branch'], { cwd: rootPath }),
      execFileAsync('git', ['log', '-1', '--pretty=format:%s%n%ct'], { cwd: rootPath })
    ])
    return parseGitStatus(statusOutput, commitOutput)
  } catch {
    return null
  }
}

function parseBranchRef(branchRef: string | undefined) {
  if (!branchRef) return null
  if (branchRef.startsWith('refs/heads/')) return branchRef.slice('refs/heads/'.length) || null
  return branchRef
}

export function parseGitWorktreeList(output: string, workspaceRootPath: string): GitWorktree[] {
  const normalizedRoot = normalize(workspaceRootPath)
  const worktrees: GitWorktree[] = []
  let current: GitWorktree | null = null

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line) continue

    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current)
      const path = normalize(line.slice('worktree '.length))
      current = {
        path,
        branch: null,
        head: null,
        isMain: path === normalizedRoot,
        isBare: false,
        isLocked: false,
        isDirty: false,
        isMissing: false,
        lastActivityAt: null,
        lastActivityRelative: null
      }
      continue
    }

    if (!current) continue

    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length) || null
      continue
    }

    if (line.startsWith('branch ')) {
      current.branch = parseBranchRef(line.slice('branch '.length))
      continue
    }

    if (line === 'bare') {
      current = null
      continue
    }

    if (line.startsWith('locked')) {
      current.isLocked = true
    }
  }

  if (current && !current.isBare) worktrees.push(current)

  if (worktrees.length > 0 && !worktrees.some((worktree) => worktree.isMain)) {
    worktrees[0].isMain = true
  }

  return worktrees.sort((left, right) => {
    if (left.isMain !== right.isMain) return left.isMain ? -1 : 1
    const leftLabel = left.branch ?? left.path
    const rightLabel = right.branch ?? right.path
    return leftLabel.localeCompare(rightLabel)
  })
}

async function collectActivityTimestamps(worktreePath: string, lastCommitTimestamp: number | null) {
  const timestamps: number[] = []
  if (lastCommitTimestamp != null && Number.isFinite(lastCommitTimestamp)) {
    timestamps.push(lastCommitTimestamp)
  }

  const paths = [worktreePath, join(worktreePath, '.git')]
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--absolute-git-dir'], { cwd: worktreePath })
    const gitDir = stdout.trim()
    if (gitDir) paths.push(join(gitDir, 'HEAD'))
  } catch {
    // Linked worktrees still have a filesystem clock even if git-dir lookup fails.
  }

  await Promise.all(
    paths.map(async (targetPath) => {
      try {
        const info = await stat(targetPath)
        timestamps.push(Math.floor(info.mtimeMs / 1000))
      } catch {
        // Path may not exist on this platform or worktree layout.
      }
    })
  )

  return timestamps
}

export async function enrichGitWorktree(worktree: GitWorktree): Promise<GitWorktree> {
  if (!(await pathExists(worktree.path))) {
    return {
      ...worktree,
      isDirty: false,
      isMissing: true,
      lastActivityAt: null,
      lastActivityRelative: null
    }
  }

  const summary = await getGitSummary(worktree.path)
  const timestamps = await collectActivityTimestamps(worktree.path, summary?.lastCommitTimestamp ?? null)
  const lastActivityAt = timestamps.length > 0 ? Math.max(...timestamps) : null

  return {
    ...worktree,
    isDirty: summary?.isDirty ?? false,
    isMissing: false,
    lastActivityAt,
    lastActivityRelative: lastActivityAt ? relativeTime(lastActivityAt) : null
  }
}

export async function listGitWorktrees(rootPath: string, options?: { enrich?: boolean }) {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: rootPath })
    const parsed = parseGitWorktreeList(stdout, rootPath)
    if (options?.enrich === false) return parsed
    return Promise.all(parsed.map((worktree) => enrichGitWorktree(worktree)))
  } catch {
    return []
  }
}

export function defaultGitWorktreesRoot(workspaceRootPath: string) {
  return join(normalize(workspaceRootPath), '.worktrees')
}

function gitignoreIncludesWorktrees(content: string) {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    return trimmed === '.worktrees' || trimmed === '.worktrees/' || trimmed === '/.worktrees' || trimmed === '/.worktrees/'
  })
}

export async function ensureGitignoreWorktreesEntry(rootPath: string) {
  const gitignorePath = join(normalize(rootPath), '.gitignore')
  const content = (await pathExists(gitignorePath)) ? await readFile(gitignorePath, 'utf8') : ''
  if (gitignoreIncludesWorktrees(content)) return

  const needsLeadingNewline = content.length > 0 && !content.endsWith('\n')
  const block = `${needsLeadingNewline ? '\n' : ''}# Local git worktrees managed by Workspace Manager\n${WORKTREES_GITIGNORE_ENTRY}\n`
  await writeFile(gitignorePath, `${content}${block}`, 'utf8')
}

export function sanitizeBranchDirectoryName(branch: string) {
  const trimmed = branch.trim().replace(/^refs\/heads\//, '')
  const sanitized = trimmed
    .replace(/[<>:"|?*]/g, '-')
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || 'worktree'
}

function gitCommandError(error: unknown) {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '').trim()
    if (stderr) return stderr
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Git command failed.'
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function convertRepoToWorktrees(rootPath: string, worktreesRoot?: string | null) {
  const normalizedRoot = normalize(rootPath)
  const resolvedRoot = normalize(worktreesRoot ?? defaultGitWorktreesRoot(normalizedRoot))
  await mkdir(resolvedRoot, { recursive: true })
  await ensureGitignoreWorktreesEntry(normalizedRoot)
  return resolvedRoot
}

export async function createGitWorktree(
  rootPath: string,
  input: {
    worktreesRoot: string
    branch: string
    createBranch?: boolean
  }
) {
  const normalizedRoot = normalize(rootPath)
  const branch = input.branch.trim().replace(/^refs\/heads\//, '')
  if (!branch) throw new Error('Branch name is required.')

  const worktreesRoot = normalize(input.worktreesRoot)
  await mkdir(worktreesRoot, { recursive: true })
  await ensureGitignoreWorktreesEntry(normalizedRoot)

  const targetPath = join(worktreesRoot, sanitizeBranchDirectoryName(branch))
  if (await pathExists(targetPath)) {
    throw new Error(`A worktree already exists at ${targetPath}`)
  }

  const args = ['worktree', 'add']
  if (input.createBranch) {
    args.push('-b', branch, targetPath)
  } else {
    args.push(targetPath, branch)
  }

  try {
    await execFileAsync('git', args, { cwd: normalizedRoot })
  } catch (error) {
    throw new Error(gitCommandError(error))
  }

  return normalize(targetPath)
}

async function pruneGitWorktrees(rootPath: string) {
  try {
    await execFileAsync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: normalize(rootPath) })
  } catch {
    // Prune is best-effort cleanup after a successful or missing remove.
  }
}

async function runGitWorktreeRemove(rootPath: string, worktreePath: string, force: boolean) {
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(worktreePath)
  await execFileAsync('git', args, { cwd: rootPath })
}

export async function removeGitWorktree(
  rootPath: string,
  worktreePath: string,
  options?: { force?: boolean; protectPaths?: string[] }
) {
  const normalizedRoot = normalize(rootPath)
  const normalizedWorktree = normalize(worktreePath)
  const worktrees = await listGitWorktrees(normalizedRoot)
  const target = worktrees.find((worktree) => normalize(worktree.path) === normalizedWorktree)
  if (!target) throw new Error(`No worktree at ${worktreePath}`)

  const protectPaths = options?.protectPaths ?? [normalizedRoot]
  const blockReason = worktreeRemoveBlockReason(target, protectPaths, { allowDirty: Boolean(options?.force) })
  if (blockReason) throw new Error(blockReason)

  const force = Boolean(options?.force) || Boolean(target.isMissing)
  try {
    await runGitWorktreeRemove(normalizedRoot, normalizedWorktree, force)
  } catch (error) {
    if (!force) {
      throw new Error(gitCommandError(error))
    }
    try {
      await runGitWorktreeRemove(normalizedRoot, normalizedWorktree, true)
    } catch (forceError) {
      await pruneGitWorktrees(normalizedRoot)
      const remaining = await listGitWorktrees(normalizedRoot, { enrich: false })
      if (remaining.some((worktree) => normalize(worktree.path) === normalizedWorktree)) {
        throw new Error(gitCommandError(forceError))
      }
    }
  }

  await pruneGitWorktrees(normalizedRoot)
  return normalizedWorktree
}

export async function cleanupGitWorktrees(
  rootPath: string,
  input: {
    maxAgeDays: number
    protectPaths?: string[]
    includeDirty?: boolean
    worktreePaths?: string[]
  }
) {
  const normalizedRoot = normalize(rootPath)
  const protectPaths = input.protectPaths ?? [normalizedRoot]
  const requested = input.worktreePaths
    ? new Set(input.worktreePaths.map((path) => normalizeComparePath(path)))
    : null
  const worktrees = await listGitWorktrees(normalizedRoot)
  const skipped: Array<{ path: string; reason: WorktreeCleanupSkipReason }> = []
  const candidates: GitWorktree[] = []

  for (const worktree of worktrees) {
    if (requested && !requested.has(normalizeComparePath(worktree.path))) continue
    const decision = classifyWorktreeForCleanup(worktree, {
      maxAgeDays: input.maxAgeDays,
      includeDirty: input.includeDirty,
      protectPaths
    })
    if (decision.eligible) {
      candidates.push(worktree)
      continue
    }
    if (decision.reason === 'stale' || decision.reason === 'missing') continue
    skipped.push({ path: worktree.path, reason: decision.reason })
  }

  const removedPaths: string[] = []
  const errors: string[] = []

  for (const candidate of candidates) {
    try {
      await removeGitWorktree(normalizedRoot, candidate.path, {
        force: Boolean(input.includeDirty) || Boolean(candidate.isMissing),
        protectPaths
      })
      removedPaths.push(candidate.path)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : gitCommandError(error))
    }
  }

  await pruneGitWorktrees(normalizedRoot)

  if (removedPaths.length === 0 && errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  return { removedPaths, skipped, errors }
}
