import { readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import fg from 'fast-glob'
import type { DetectedProject, GitWorktree, PackageManager } from '@shared/types'
import { normalizeComparePath } from '@shared/worktreeExecution'
import { listGitWorktrees } from './git'
import {
  createId, detectDockerConfig, detectPackageManagerFromField, detectPythonEnvironment,
  detectPythonNameFromPyproject, exists, getWorkspacePatterns, readJson, readText
} from './discoveryMetadata'

const CONCURRENCY = 16
const MAX_DEPTH = 4
const IGNORED_DIRECTORIES = [
  'node_modules', '.git', '.venv', 'venv', 'env', 'pycache', '__pycache__',
  'dist', 'build', 'out', '.next', '.turbo', '.cache', 'coverage', '.worktrees'
]
const PYTHON_MARKERS = ['requirements.txt', 'pyproject.toml', 'setup.py']
const ROOT_PYTHON_MARKERS = [...PYTHON_MARKERS, 'requirements-dev.txt', 'requirements.in', 'Pipfile', 'setup.cfg', 'environment.yml', 'environment.yaml']
const DOCKER_MARKERS = ['Dockerfile', 'compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']

export interface ProjectDiscoveryOptions {
  gitWorktreesRoot?: string | null
  gitWorktrees?: GitWorktree[]
}

async function mapLimited<T, R>(items: T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await map(items[index]!)
    }
  }))
  return results
}

function relativePath(rootPath: string, path: string) {
  return relative(rootPath, path).replaceAll('\\', '/')
}

function isInside(rootPath: string, path: string) {
  const rel = relative(rootPath, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

/** Scan the main checkout. All persisted paths in the resulting projects are relative. */
export async function discoverProjects(rootPath: string, options: ProjectDiscoveryOptions = {}): Promise<DetectedProject[]> {
  const root = resolve(rootPath)
  const ignoredNames = new Set(IGNORED_DIRECTORIES)
  const worktrees = options.gitWorktrees ?? await listGitWorktrees(root, { enrich: false })
  const excludedPaths = [
    options.gitWorktreesRoot,
    ...worktrees.filter((worktree) => normalizeComparePath(worktree.path) !== normalizeComparePath(root)).map((worktree) => worktree.path)
  ].filter((path): path is string => Boolean(path)).map((path) => resolve(path))
  const excludedKeys = excludedPaths.map(normalizeComparePath)
  const excluded = (path: string) => {
    const key = normalizeComparePath(path)
    return excludedKeys.some((entry) => key === entry || key.startsWith(`${entry}/`))
  }

  const rootManifest = await readJson<Record<string, unknown>>(join(root, 'package.json'))
  const patterns = await getWorkspacePatterns(root, rootManifest)
  const manifestPatterns = patterns.map((pattern) => `${pattern.replaceAll('\\', '/').replace(/\/$/, '')}/package.json`)
  const declaredManifests = manifestPatterns.length === 0 ? [] : await fg(manifestPatterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    concurrency: CONCURRENCY,
    ignore: [
      ...IGNORED_DIRECTORIES.map((name) => `**/${name}/**`),
      ...excludedPaths.filter((path) => isInside(root, path)).map((path) => `${fg.escapePath(relativePath(root, path))}/**`)
    ]
  })
  const declared = new Set(declaredManifests.map(dirname).filter((path) => isInside(root, path) && !excluded(path)))

  // Breadth-first batches bound directory reads, including in wide repositories.
  const directories = new Map<string, Set<string>>()
  let pending = [root]
  for (let depth = 0; depth <= MAX_DEPTH && pending.length > 0; depth++) {
    const children = await mapLimited(pending, async (path) => {
      const entries = await readdir(path, { withFileTypes: true })
      directories.set(path, new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name)))
      if (depth === MAX_DEPTH) return []
      return entries.filter((entry) => entry.isDirectory() && !ignoredNames.has(entry.name))
        .map((entry) => join(path, entry.name)).filter((child) => !excluded(child))
    })
    pending = children.flat()
  }
  // Declared packages retain the existing glob behavior, including paths deeper than the scan limit.
  await mapLimited([...declared].filter((path) => !directories.has(path)), async (path) => {
    const entries = await readdir(path, { withFileTypes: true })
    directories.set(path, new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name)))
  })

  const managers = new Map<string, Promise<PackageManager>>()
  function packageManager(path: string): Promise<PackageManager> {
    const cached = managers.get(path)
    if (cached) return cached
    const result = (async () => {
      const manifest = await readJson<Record<string, unknown>>(join(path, 'package.json'))
      const field = detectPackageManagerFromField(typeof manifest?.packageManager === 'string' ? manifest.packageManager : undefined)
      if (field !== 'unknown') return field
      for (const [lockfile, manager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm']] as const) {
        if (await exists(join(path, lockfile))) return manager
      }
      return path === root ? 'npm' : packageManager(dirname(path))
    })()
    managers.set(path, result)
    return result
  }

  const projects = await mapLimited([...directories], async ([path, files]): Promise<DetectedProject | null> => {
    const isRoot = path === root
    const isDeclared = declared.has(path)
    const node = files.has('package.json') && (isRoot || isDeclared || patterns.length === 0)
    const pythonMarker = (isRoot ? ROOT_PYTHON_MARKERS : PYTHON_MARKERS).some((file) => files.has(file))
    const docker = DOCKER_MARKERS.some((file) => files.has(file))
    if (!isRoot && !node && !pythonMarker && !docker) return null
    const manifest = node ? await readJson<Record<string, unknown>>(join(path, 'package.json')) : null
    const [dockerConfig, environment, pyproject] = await Promise.all([
      docker ? detectDockerConfig(path) : null,
      pythonMarker || isRoot ? detectPythonEnvironment(path) : null,
      pythonMarker ? readText(join(path, 'pyproject.toml')) : null
    ])
    const python = pythonMarker || (isRoot && environment !== null)
    const scripts = manifest?.scripts && typeof manifest.scripts === 'object'
      ? Object.fromEntries(Object.entries(manifest.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {}
    return {
      id: isRoot ? 'root' : createId(path),
      name: typeof manifest?.name === 'string' ? manifest.name : detectPythonNameFromPyproject(pyproject) ?? basename(path),
      relativePath: relativePath(root, path),
      capabilities: [...(node ? ['node' as const] : []), ...(python ? ['python' as const] : []), ...(docker ? ['docker' as const] : [])],
      source: isRoot ? 'root' : isDeclared ? 'declared' : 'scanned',
      packageManager: node ? await packageManager(path) : null,
      scripts,
      docker: dockerConfig,
      python: python ? {
        venvRelativePath: environment ? relativePath(path, environment.rootPath) : null,
        installSource: ['requirements.txt', 'requirements-dev.txt', 'requirements.in'].some((file) => files.has(file)) ? 'requirements' : files.has('pyproject.toml') ? 'pyproject' : null
      } : null
    }
  })
  return projects.filter((project): project is DetectedProject => project !== null)
    .sort((left, right) => left.source === 'root' ? -1 : right.source === 'root' ? 1 : left.relativePath.localeCompare(right.relativePath))
}
