import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from './store'
import { decodeWorkspaceState } from '@shared/workspaceModel'
import { defaultUiState } from '@shared/navigation'

const disk = vi.hoisted(() => ({ directory: '', failBackup: false, writes: [] as boolean[] }))
vi.mock('node:fs', async (load) => {
  const original = await load<typeof import('node:fs')>()
  return { ...original, copyFileSync: (from: string, to: string, mode?: number) => {
    if (disk.failBackup) throw new Error('Backup denied')
    return original.copyFileSync(from, to, mode)
  } }
})
vi.mock('electron-store', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  return { default: class {
    readonly path: string
    constructor(options: { name: string }) { this.path = path.join(disk.directory, options.name + '.json') }
    get store(): Record<string, unknown> {
      return fs.existsSync(this.path) ? JSON.parse(fs.readFileSync(this.path, 'utf8')) : {}
    }
    set store(value: Record<string, unknown>) {
      if (this.path.endsWith('workspace-manager.json')) disk.writes.push(fs.existsSync(path.join(disk.directory, 'workspace-manager.v11.backup.json')))
      fs.writeFileSync(this.path, JSON.stringify(value))
    }
    get(key: string) { return this.store[key] }
    set(key: string, value: unknown) { this.store = { ...this.store, [key]: value } }
  } }
})

const original = readFileSync(new URL('../shared/fixtures/store-v11.json', import.meta.url), 'utf8')
const stores: AppStore[] = []
const config = () => join(disk.directory, 'workspace-manager.json')
const backup = () => join(disk.directory, 'workspace-manager.v11.backup.json')
const readState = () => JSON.parse(readFileSync(config(), 'utf8'))
function open() { const store = new AppStore(); stores.push(store); return store }

beforeEach(() => {
  disk.directory = mkdtempSync(join(tmpdir(), 'wsm-store-migration-'))
  disk.failBackup = false
  disk.writes = []
  writeFileSync(config(), original)
})
afterEach(() => {
  for (const store of stores.splice(0)) store.flushPendingWrites()
  rmSync(disk.directory, { recursive: true, force: true })
})

describe('AppStore schema migrations', () => {
  it('backs up before writing, migrates memberships and terminals, and removes legacy keys', () => {
    const store = open()
    expect(readFileSync(backup(), 'utf8')).toBe(original)
    expect(disk.writes).toEqual([true])
    expect(store.migratedFromLegacy).toBe(true)
    const state = readState()
    expect(state.version).toBe(14)
    expect(state).not.toHaveProperty('collections')
    expect(state.workspaces[0]).not.toHaveProperty('groupIds')
    for (const key of ['rootScripts', 'workspacePackages', 'docker', 'pythonEnvironment', 'packageManager', 'isMonorepo']) {
      expect(state.workspaces[0]).not.toHaveProperty(key)
    }
    expect(state.groups.map((group: { color: unknown }) => group.color)).toEqual([null, null])
    expect(state.workspaces[0].groupId).toBe('active')
    expect(state.workspaces[0].projects[0].python.venvRelativePath).toBe('.venv')
    expect(state.terminals[0]).toMatchObject({ workspaceId: 'p1', projectId: null, buffer: 'ready\r\n' })
    expect(store.getMigrationNotes()).toEqual(["demo was also in 'Backend'; kept 'Active'"])
  })

  it('migrates v12 by adding ui defaults without losing canonical data or creating a v11 backup', () => {
    const { ui: _ui, ...v12 } = decodeWorkspaceState(JSON.parse(original))
    v12.version = 12
    writeFileSync(config(), JSON.stringify(v12))
    const store = open()
    expect(readState()).toEqual({ ...v12, version: 14, ui: defaultUiState() })
    expect(store.migratedFromLegacy).toBe(false)
    expect(existsSync(backup())).toBe(false)
    expect(store.getUiState()).toMatchObject({ selectedWorkspaceId: 'p1', consoleTabFilter: 'all' })
  })

  it('migrates v13 settings and preserves navigation, notes and workspaces', () => {
    const v13 = decodeWorkspaceState(JSON.parse(original))
    v13.version = 13
    v13.ui.sidebarCollapsed = false
    writeFileSync(config(), JSON.stringify({ ...v13, settings: { preferredShell: 'bash' } }))
    const store = open()
    expect(readState().version).toBe(14)
    expect(readState().ui).toEqual(v13.ui)
    expect(readState().workspaces).toEqual(v13.workspaces)
    expect(readState().migrationNotes).toEqual(v13.migrationNotes)
    expect(store.getSettings()).toMatchObject({ preferredShell: 'bash', nodeCaCertificate: null, preferredExternalTerminal: 'auto', defaultOpenTarget: 'cursor' })
    expect(existsSync(backup())).toBe(false)
  })

  it('persists settings and per-workspace Open overrides across reopen and rejects missing certificates', () => {
    const store = open()
    const certificate = join(disk.directory, 'CA certificate.pem')
    writeFileSync(certificate, 'certificate')
    store.updateSettings({ nodeCaCertificate: certificate, preferredExternalTerminal: 'kitty', defaultOpenTarget: 'terminal', preferredShell: 'bash' })
    store.upsertWorkspaceRecord({ ...store.getWorkspaceRecord('p1')!, openTarget: 'folder' })
    expect(open().getSettings()).toMatchObject({ nodeCaCertificate: certificate, preferredExternalTerminal: 'kitty', defaultOpenTarget: 'terminal', preferredShell: 'bash' })
    expect(open().getWorkspaceRecord('p1')?.openTarget).toBe('folder')
    expect(() => store.updateSettings({ nodeCaCertificate: join(disk.directory, 'gone.pem') })).toThrow('existing CA')
    store.updateSettings({ nodeCaCertificate: null })
    expect(open().getSettings().nodeCaCertificate).toBeNull()
  })

  it('restores saved navigation on reopen and falls back when a checkout disappears on disk', () => {
    const store = open()
    const root = join(disk.directory, 'main')
    const feature = join(disk.directory, 'feature')
    mkdirSync(root)
    mkdirSync(feature)
    const workspace = { ...store.getWorkspaceRecord('p1')!, rootPath: root, gitWorktrees: [] }
    store.setWorkspaceRecords([workspace])
    const tree = { path: feature, branch: 'feature', head: null, isMain: false, isBare: false, isLocked: false, isDirty: false, isMissing: false, lastActivityAt: null, lastActivityRelative: null }
    store.setWorkspaceRecords([{ ...workspace, gitWorktrees: [{ ...tree, path: root, branch: 'main', isMain: true }, tree] }])
    const ui = { ...defaultUiState(), selectedGroupId: 'active', selectedWorkspaceId: 'p1', selectedWorktreeByWorkspace: { p1: feature }, sidebarCollapsed: false, collapsedGroupIds: ['active'], consoleTabFilter: 'worktree' as const }
    store.setUiState(ui)
    expect(open().getUiState()).toEqual(ui)
    rmSync(feature, { recursive: true })
    expect(open().getUiState()).toEqual({ ...ui, selectedWorktreeByWorkspace: { p1: root } })
    store.removeWorkspace('p1')
    expect(open().getUiState()).toMatchObject({ selectedWorkspaceId: null, selectedWorktreeByWorkspace: {} })
  })

  it('retains an existing backup and never repeats migration after dismissal', () => {
    writeFileSync(backup(), 'keep this backup')
    const store = open()
    store.clearMigrationNotes()
    const bytes = readFileSync(config(), 'utf8')
    disk.writes = []
    const reloaded = open()
    expect(reloaded.migratedFromLegacy).toBe(false)
    expect(reloaded.getMigrationNotes()).toEqual([])
    expect(readFileSync(backup(), 'utf8')).toBe('keep this backup')
    expect(readFileSync(config(), 'utf8')).toBe(bytes)
    expect(disk.writes).toEqual([])
  })

  it('aborts without writing if the backup cannot be created', () => {
    disk.failBackup = true
    expect(() => open()).toThrow('Backup denied')
    expect(readFileSync(config(), 'utf8')).toBe(original)
    expect(disk.writes).toEqual([])
  })

  it('writes workspace records and group colors in the v12 shape', () => {
    const store = open()
    const workspace = store.getWorkspaceRecord('p1')!
    const python = { ...workspace.projects[0]!, id: 'api', relativePath: 'services/api', source: 'scanned' as const }
    store.setWorkspaceRecords([{ ...workspace, groupId: null, openTarget: 'cursor', projects: [...workspace.projects, python] }])
    store.setGroups([{ id: 'g1', name: 'Backend', order: 0, color: '#336699' }])
    expect(store.getWorkspaceRecord('p1')).toMatchObject({ groupId: null, openTarget: 'cursor', projects: expect.arrayContaining([python]) })
    expect(readState().groups).toEqual([{ id: 'g1', name: 'Backend', order: 0, color: '#336699' }])
    expect(readState().workspaces[0]).not.toHaveProperty('rootScripts')
    expect(readState().workspaces[0]).not.toHaveProperty('groupIds')
  })

  it('persists terminal workspace and detected-project ownership separately', () => {
    const store = open()
    store.setTerminals([{ ...store.getTerminals()[0]!, projectId: 'pkg-web' }])
    store.flushPendingWrites()
    expect(readState().terminals[0]).toMatchObject({ workspaceId: 'p1', projectId: 'pkg-web' })
  })

  it('migrates older versions and initializes fresh stores at v14', () => {
    writeFileSync(config(), JSON.stringify({ ...JSON.parse(original), version: 10 }))
    expect(open().getWorkspaceRecord('p1')?.id).toBe('p1')
    expect(readState().version).toBe(14)
    rmSync(config())
    rmSync(backup())
    const fresh = open()
    expect(fresh.getWorkspaceRecords()).toEqual([])
    expect(fresh.getGroups()).toEqual([])
    expect(readState().version).toBe(14)
    expect(existsSync(backup())).toBe(false)
  })

  it('keeps the platform default shell when an older store has no settings', () => {
    const { settings: _settings, ...state } = JSON.parse(original)
    writeFileSync(config(), JSON.stringify(state))
    expect(open().getPreferredShell()).toBe(process.platform === 'win32' ? 'powershell' : 'bash')
  })
})
