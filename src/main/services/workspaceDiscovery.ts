import { readdir } from 'node:fs/promises'
import { basename, join, normalize, relative } from 'node:path'
import fg from 'fast-glob'
import type {
  WorkspaceCandidate,
  LegacyWorkspaceRecord,
  LegacyWorkspacePackage
} from '@shared/types'
import { defaultGitWorktreesRoot, getGitSummary, listGitWorktrees } from '@main/services/git'
import {
  exists,
  readJson,
  readText,
  createId,
  detectPackageManagerFromField,
  getWorkspacePatterns,
  detectDockerConfig,
  detectPythonEnvironment,
  detectPythonNameFromPyproject
} from './discoveryMetadata'

const PYTHON_PROJECT_FILES = [
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'Pipfile',
  'setup.py',
  'setup.cfg',
  'environment.yml',
  'environment.yaml'
]
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
const DOCKER_MARKER_FILES = ['Dockerfile', ...COMPOSE_FILES]

async function detectDeclaredProjects(rootPath: string, patterns: string[]) {
  if (!patterns.length) return []

  const manifestPaths = await fg(
    patterns.map((pattern) => normalize(join(pattern, 'package.json')).replaceAll('\\', '/')),
    {
      cwd: rootPath,
      onlyFiles: true,
      unique: true,
      ignore: ['**/node_modules/**']
    }
  )

  const projects: LegacyWorkspacePackage[] = []

  for (const manifestPath of manifestPaths) {
    const absManifest = join(rootPath, manifestPath)
    const packageJson = await readJson<{ name?: string; scripts?: Record<string, string> }>(absManifest)
    if (!packageJson) continue

    const absPath = normalize(join(rootPath, manifestPath.replace(/\/package\.json$/, '')))
    projects.push({
      id: createId(absPath),
      name: packageJson.name ?? basename(absPath),
      relativePath: relative(rootPath, absPath) || '.',
      absPath,
      scripts: packageJson.scripts ?? {}
    })
  }

  return projects.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function detectPythonManifestFiles(rootPath: string) {
  const checks = await Promise.all(
    PYTHON_PROJECT_FILES.map(async (file) => ((await exists(join(rootPath, file))) ? file : null))
  )

  return checks.filter((file): file is string => Boolean(file))
}

async function hasAnyFile(rootPath: string, fileNames: string[]) {
  const found = await Promise.all(fileNames.map((fileName) => exists(join(rootPath, fileName))))
  return found.some(Boolean)
}

export async function detectWorkspaceCandidate(rootPath: string): Promise<WorkspaceCandidate | null> {
  const normalized = normalize(rootPath)
  const [hasGit, hasPackageJson, pythonManifestFiles, hasDockerMarker] = await Promise.all([
    exists(join(normalized, '.git')),
    exists(join(normalized, 'package.json')),
    detectPythonManifestFiles(normalized),
    hasAnyFile(normalized, DOCKER_MARKER_FILES)
  ])

  if (!hasGit && !hasPackageJson && pythonManifestFiles.length === 0 && !hasDockerMarker) return null

  return {
    rootPath: normalized,
    name: basename(normalized),
    hasGit,
    hasPackageJson
  }
}

export async function findCandidatesFromPaths(paths: string[]) {
  const candidates = await Promise.all(paths.map((path) => detectWorkspaceCandidate(path)))
  return expandCandidatesWithWorktrees(
    candidates.filter((candidate): candidate is WorkspaceCandidate => Boolean(candidate))
  )
}

export async function expandCandidatesWithWorktrees(candidates: WorkspaceCandidate[]) {
  const seen = new Set(candidates.map((candidate) => normalize(candidate.rootPath)))
  const expanded = [...candidates]

  for (const candidate of candidates) {
    if (!candidate.hasGit) continue

    const worktrees = await listGitWorktrees(candidate.rootPath, { enrich: false })
    for (const worktree of worktrees) {
      if (worktree.isBare || seen.has(worktree.path)) continue

      const worktreeCandidate = await detectWorkspaceCandidate(worktree.path)
      if (!worktreeCandidate) continue

      seen.add(worktree.path)
      expanded.push({
        ...worktreeCandidate,
        isGitWorktree: !worktree.isMain,
        sourceWorkspacePath: candidate.rootPath
      })
    }
  }

  return expanded.sort((left, right) => left.rootPath.localeCompare(right.rootPath))
}

export async function findCandidatesInParent(parentPath: string) {
  const entries = await readdir(parentPath, { withFileTypes: true }).catch(() => [])
  const childPaths = entries.filter((entry) => entry.isDirectory()).map((entry) => join(parentPath, entry.name))
  return findCandidatesFromPaths(childPaths)
}

export async function buildWorkspaceRecord(
  rootPath: string,
  groupIds: string[],
  previous?: LegacyWorkspaceRecord | null
) {
  const manifestPath = join(rootPath, 'package.json')
  const pyprojectPath = join(rootPath, 'pyproject.toml')
  const manifest = await readJson<{
    name?: string
    scripts?: Record<string, string>
    packageManager?: string
  }>(manifestPath)
  const [rawPyproject, pythonEnvironment] = await Promise.all([
    readText(pyprojectPath),
    detectPythonEnvironment(rootPath)
  ])

  const patterns = await getWorkspacePatterns(rootPath, manifest as Record<string, unknown> | null)
  const workspacePackages = await detectDeclaredProjects(rootPath, patterns)
  const docker = await detectDockerConfig(rootPath)

  let packageManager = detectPackageManagerFromField(manifest?.packageManager)
  if (packageManager === 'unknown') {
    if (await exists(join(rootPath, 'pnpm-lock.yaml'))) packageManager = 'pnpm'
    else if (await exists(join(rootPath, 'yarn.lock'))) packageManager = 'yarn'
    else if (await exists(join(rootPath, 'package-lock.json')) || manifest) packageManager = 'npm'
  }

  const [gitSummary, gitWorktrees] = await Promise.all([
    getGitSummary(rootPath),
    listGitWorktrees(rootPath)
  ])
  const pythonName = detectPythonNameFromPyproject(rawPyproject)

  const detectedName = manifest?.name ?? pythonName ?? basename(rootPath)

  return {
    id: previous?.id ?? createId(rootPath),
    name: previous?.nameOverride ?? detectedName,
    nameOverride: previous?.nameOverride ?? null,
    order: previous?.order ?? 0,
    rootPath,
    groupIds: Array.from(new Set(groupIds)),
    packageManager,
    isMonorepo: workspacePackages.length > 0,
    rootScripts: manifest?.scripts ?? {},
    workspacePackages,
    docker,
    pythonEnvironment,
    commandChains: previous?.commandChains ?? {},
    favoriteCommandIds: previous?.favoriteCommandIds ?? [],
    runActions: previous?.runActions ?? [],
    defaultRunActionId: previous?.defaultRunActionId ?? null,
    pinnedEndpoints: previous?.pinnedEndpoints ?? [],
    pinnedPorts: [],
    lastScanAt: Date.now(),
    quickLinks: previous?.quickLinks ?? [],
    gitSummary,
    gitWorktrees,
    gitWorktreesRoot: previous?.gitWorktreesRoot ? defaultGitWorktreesRoot(rootPath) : null
  } satisfies LegacyWorkspaceRecord
}
