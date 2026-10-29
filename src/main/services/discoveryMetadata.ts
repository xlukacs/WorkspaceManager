import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import type { DockerConfig, PackageManager, PythonEnvironment } from '@shared/types'

const ID_SEED = 5381
const PYTHON_ENV_PRIORITY = ['.venv', 'venv', 'env']
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']

export async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function readText(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export function createId(input: string) {
  let hash = ID_SEED
  for (const char of input) {
    hash = ((hash << 5) + hash) + char.charCodeAt(0)
  }
  return Math.abs(hash).toString(36)
}

export function detectPackageManagerFromField(packageManager: string | undefined): PackageManager {
  if (!packageManager) return 'unknown'
  if (packageManager.startsWith('pnpm')) return 'pnpm'
  if (packageManager.startsWith('yarn')) return 'yarn'
  if (packageManager.startsWith('npm')) return 'npm'
  return 'unknown'
}

export async function getWorkspacePatterns(rootPath: string, manifest: Record<string, unknown> | null) {
  const direct = manifest?.workspaces
  if (Array.isArray(direct)) {
    return direct.filter((value): value is string => typeof value === 'string')
  }

  if (direct && typeof direct === 'object') {
    const packages = (direct as { packages?: unknown }).packages
    if (Array.isArray(packages)) {
      return packages.filter((value): value is string => typeof value === 'string')
    }
  }

  const pnpmWorkspace = await readFile(join(rootPath, 'pnpm-workspace.yaml'), 'utf8').catch(() => null)
  if (!pnpmWorkspace) return []

  const parsed = YAML.parse(pnpmWorkspace) as { packages?: string[] } | null
  return parsed?.packages ?? []
}

export async function detectDockerConfig(rootPath: string): Promise<DockerConfig | null> {
  let composeFile: string | null = null
  for (const candidate of COMPOSE_FILES) {
    if (await exists(join(rootPath, candidate))) {
      composeFile = candidate
      break
    }
  }

  const dockerfile = await exists(join(rootPath, 'Dockerfile')) ? 'Dockerfile' : null
  if (!composeFile && !dockerfile) return null

  let services: string[] = []
  if (composeFile) {
    const rawCompose = await readFile(join(rootPath, composeFile), 'utf8').catch(() => null)
    if (rawCompose) {
      const parsed = YAML.parse(rawCompose) as { services?: Record<string, unknown> } | null
      services = Object.keys(parsed?.services ?? {}).sort((left, right) => left.localeCompare(right))
    }
  }

  return {
    composeFile,
    dockerfile,
    services
  }
}

export async function detectPythonEnvironment(rootPath: string): Promise<PythonEnvironment | null> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => [])
  const seen = new Set<string>()
  const candidateNames = [
    ...PYTHON_ENV_PRIORITY,
    ...entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  ]

  const rankedNames = candidateNames.filter((name) => {
    if (seen.has(name)) return false
    seen.add(name)
    return true
  }).sort((left, right) => {
    const leftPriority = PYTHON_ENV_PRIORITY.indexOf(left)
    const rightPriority = PYTHON_ENV_PRIORITY.indexOf(right)
    const resolvedLeft = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority
    const resolvedRight = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority
    if (resolvedLeft !== resolvedRight) return resolvedLeft - resolvedRight
    return left.localeCompare(right)
  })

  for (const name of rankedNames) {
    const envRoot = join(rootPath, name)
    const windowsPython = join(envRoot, 'Scripts', 'python.exe')
    const unixPython = join(envRoot, 'bin', 'python')
    const [hasMarker, hasWindowsPython, hasUnixPython] = await Promise.all([
      exists(join(envRoot, 'pyvenv.cfg')),
      exists(windowsPython),
      exists(unixPython)
    ])

    const pythonPath = hasWindowsPython ? windowsPython : hasUnixPython ? unixPython : null
    const scriptsPath = hasWindowsPython ? join(envRoot, 'Scripts') : hasUnixPython ? join(envRoot, 'bin') : null
    if (!pythonPath || !scriptsPath || (!hasMarker && !hasWindowsPython && !hasUnixPython)) continue

    return {
      id: createId(envRoot),
      name,
      kind: 'venv',
      rootPath: envRoot,
      scriptsPath,
      pythonPath
    }
  }

  return null
}

export function detectPythonNameFromPyproject(rawPyproject: string | null) {
  if (!rawPyproject) return null

  const workspaceMatch = rawPyproject.match(/\[project\][\s\S]*?^\s*name\s*=\s*["']([^"']+)["']/m)
  if (workspaceMatch?.[1]) return workspaceMatch[1]

  const poetryMatch = rawPyproject.match(/\[tool\.poetry\][\s\S]*?^\s*name\s*=\s*["']([^"']+)["']/m)
  if (poetryMatch?.[1]) return poetryMatch[1]

  return null
}
