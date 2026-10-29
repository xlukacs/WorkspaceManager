import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { candidateStorePaths, loadStoredState, loadWorkspaceState, resolveStorePath, StoreNotFoundError } from '@agent/loadStore'
import { stateToDisk } from '@shared/persistedState'
import { decodeWorkspaceState } from '@shared/workspaceModel'
import type { LegacyState } from '@shared/types'

async function withTempStore(state: LegacyState) {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-manager-store-'))
  const storePath = join(dir, 'workspace-manager.json')
  await writeFile(storePath, JSON.stringify(stateToDisk(state)))
  return { dir, storePath }
}

const emptyState: LegacyState = {
  version: 11,
  groups: [{ id: 'active', name: 'Active', order: 0 }],
  workspaces: [{
    id: 'p1',
    name: 'demo',
    nameOverride: null,
    order: 0,
    rootPath: '/tmp/demo',
    groupIds: ['active'],
    packageManager: 'pnpm',
    isMonorepo: false,
    rootScripts: { dev: 'vite' },
    workspacePackages: [],
    docker: null,
    pythonEnvironment: null,
    commandChains: {},
    favoriteCommandIds: [],
    runActions: [],
    defaultRunActionId: null,
    lastScanAt: 1,
    quickLinks: [],
    gitSummary: null,
    gitWorktrees: [],
    gitWorktreesRoot: null
  }],
  terminals: [],
  settings: { preferredShell: 'bash' }
}

describe('agent store loading', () => {
  it('prefers an explicit store path and WORKSPACE_MANAGER_STORE', () => {
    const paths = candidateStorePaths({
      storePath: '/explicit/workspace-manager.json',
      env: { WORKSPACE_MANAGER_STORE: '/env/workspace-manager.json', XDG_CONFIG_HOME: '/xdg' },
      home: '/home/dev'
    })
    expect(paths[0]).toBe('/explicit/workspace-manager.json')
    expect(paths[1]).toBe('/env/workspace-manager.json')
    expect(paths).toContain('/xdg/workspace-manager/workspace-manager.json')
    expect(paths).toContain('/xdg/Workspace Manager/workspace-manager.json')
    expect(paths.indexOf('/xdg/workspace-manager/workspace-manager.json'))
      .toBeLessThan(paths.indexOf('/xdg/Workspace Manager/workspace-manager.json'))
  })

  it('loads and normalizes workspaces from the store file', async () => {
    const { dir, storePath } = await withTempStore(emptyState)
    try {
      const loaded = loadStoredState({ storePath, env: {}, home: dir })
      expect(loaded.workspaces[0]?.name).toBe('demo')
      expect(loaded.workspaces[0]?.pinnedEndpoints).toEqual([])
      expect(resolveStorePath({ storePath, env: {}, home: dir })).toBe(storePath)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws when no store file exists', () => {
    expect(() => resolveStorePath({
      env: { XDG_CONFIG_HOME: '/missing-config' },
      home: '/missing-home'
    })).toThrow(StoreNotFoundError)
  })

  it.each([12, 13, 14])('reads v%s stores without changing their bytes', async (version) => {
    const { dir, storePath } = await withTempStore(emptyState)
    try {
      const migrated = decodeWorkspaceState(stateToDisk(emptyState))
      const bytes = JSON.stringify({ ...migrated, version })
      await writeFile(storePath, bytes)
      const loaded = loadStoredState({ storePath, env: {}, home: dir })
      expect(loaded.version).toBe(14)
      expect(loaded.workspaces[0]).toMatchObject({ id: 'p1', groupIds: ['active'], rootScripts: { dev: 'vite' } })
      expect(await readFile(storePath, 'utf8')).toBe(bytes)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses the platform default shell when a store has no settings', async () => {
    const { dir, storePath } = await withTempStore(emptyState)
    try {
      const { settings: _settings, ...state } = stateToDisk(emptyState)
      await writeFile(storePath, JSON.stringify(state))
      expect(loadWorkspaceState({ storePath }).settings.preferredShell).toBe(process.platform === 'win32' ? 'powershell' : 'bash')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
