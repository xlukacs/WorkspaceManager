import { normalizeSettings } from '@shared/settings'
import { defaultUiState, normalizeUiState } from '@shared/navigation'
import Store from 'electron-store'
import { constants, copyFileSync, existsSync, statSync } from 'node:fs'
import { platform } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { AppSettings, GroupRecord, UiState, StoredState, WorkspaceRecord, TerminalSession } from '@shared/types'
import type { PersistedState } from '@shared/persistedState'
import { decodeWorkspaceState, normalizeWorkspaceRecord, WORKSPACE_STORE_VERSION } from '@shared/workspaceModel'

type WindowBounds = NonNullable<StoredState['settings']['windowBounds']>

const TERMINAL_PERSIST_WAIT_MS = 800

function windowBoundsEqual(left: WindowBounds, right: WindowBounds) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
    && left.isMaximized === right.isMaximized
}

function commandExists(command: string) {
  if (command.includes('/') || command.includes('\\')) return existsSync(command)
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .some((entry) => existsSync(join(entry, command)))
}

function getDefaultShellPreference(): StoredState['settings']['preferredShell'] {
  return platform() === 'win32' ? 'powershell' : 'bash'
}

function normalizePreferredShell(
  preferredShell: StoredState['settings']['preferredShell'] | undefined
): StoredState['settings']['preferredShell'] {
  if (platform() === 'win32') return preferredShell ?? getDefaultShellPreference()
  if (preferredShell === 'powershell' && commandExists('pwsh')) return preferredShell
  return 'bash'
}
const STORE_VERSION = WORKSPACE_STORE_VERSION

const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  width: 1560,
  height: 980,
  isMaximized: false
}

const defaultState: StoredState = {
  version: STORE_VERSION,
  groups: [],
  workspaces: [],
  terminals: [],
  migrationNotes: [],
  ui: defaultUiState(),
  settings: normalizeSettings({ preferredShell: getDefaultShellPreference(), windowBounds: DEFAULT_WINDOW_BOUNDS })
}

export class AppStore {
  private readonly store = new Store<StoredState>({ name: 'workspace-manager' })

  private readonly windowStore = new Store<{ bounds?: WindowBounds }>({
    name: 'window-state'
  })

  private pendingTerminals: TerminalSession[] | null = null
  private terminalsPersistTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.migratedFromLegacy = this.migrate()
  }

  readonly migratedFromLegacy: boolean

  getStorePath() {
    return this.store.path
  }

  private migrate() {
    const raw = this.store.store as StoredState | Partial<PersistedState>
    const migrated = (raw.version ?? 0) < STORE_VERSION
    const state = Object.keys(raw).length === 0 ? defaultState : decodeWorkspaceState(raw)
    if (migrated) {
      const backup = join(dirname(this.store.path), 'workspace-manager.v11.backup.json')
      if ((raw.version ?? 0) < 12 && existsSync(this.store.path) && !existsSync(backup)) {
        copyFileSync(this.store.path, backup, constants.COPYFILE_EXCL)
      }
      this.store.store = {
        ...state,
        settings: {
          ...state.settings,
          preferredShell: normalizePreferredShell(raw.settings?.preferredShell),
          windowBounds: state.settings.windowBounds ?? DEFAULT_WINDOW_BOUNDS
        }
      }
    }
    return (raw.version ?? 0) < 12 && state.workspaces.length > 0
  }

  private normalizeTerminals(terminals: TerminalSession[]) {
    return terminals.map((terminal) => ({
      ...terminal,
      projectId: terminal.projectId ?? null,
      pinned: terminal.pinned ?? false,
      workspacePaused: terminal.workspacePaused ?? false,
      pythonEnvironment: terminal.pythonEnvironment ?? null,
      worktreePath: terminal.worktreePath ?? null
    }))
  }

  getGroups(): GroupRecord[] {
    return this.store.get('groups').map((group) => ({ ...group, color: group.color ?? null }))
  }

  setGroups(groups: GroupRecord[]) {
    this.store.set('groups', groups.map((group) => ({ ...group, color: group.color ?? null })))
  }

  getWorkspaceRecords(): WorkspaceRecord[] {
    return this.store.get('workspaces').map(normalizeWorkspaceRecord)
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
  }

  getWorkspaceRecord(workspaceId: string) {
    return this.getWorkspaceRecords().find((workspace) => workspace.id === workspaceId) ?? null
  }

  upsertWorkspaceRecord(workspace: WorkspaceRecord) {
    const existing = this.getWorkspaceRecords()
    const index = existing.findIndex((entry) => entry.id === workspace.id)
    if (index === -1) existing.push(workspace)
    else existing[index] = workspace
    this.store.set('workspaces', existing.map(normalizeWorkspaceRecord))
    return workspace
  }

  setWorkspaceRecords(workspaces: WorkspaceRecord[]) {
    this.store.set('workspaces', workspaces.map(normalizeWorkspaceRecord))
  }

  removeWorkspace(workspaceId: string) {
    this.store.set('workspaces', this.getWorkspaceRecords().filter((workspace) => workspace.id !== workspaceId))
  }

  getUiState(): UiState {
    return normalizeUiState(this.store.get('ui'), this.getGroups(), this.getWorkspaceRecords(), existsSync)
  }

  setUiState(ui: UiState) {
    this.store.set('ui', normalizeUiState(ui, this.getGroups(), this.getWorkspaceRecords(), existsSync))
  }

  getMigrationNotes() {
    return this.store.get('migrationNotes') ?? []
  }

  clearMigrationNotes() {
    this.store.set('migrationNotes', [])
  }

  getTerminals() {
    if (this.pendingTerminals) return this.pendingTerminals
    return this.normalizeTerminals(this.store.get('terminals'))
  }

  setTerminals(terminals: TerminalSession[]) {
    this.pendingTerminals = this.normalizeTerminals(terminals)
    if (this.terminalsPersistTimer) clearTimeout(this.terminalsPersistTimer)
    this.terminalsPersistTimer = setTimeout(() => this.flushPendingWrites(), TERMINAL_PERSIST_WAIT_MS)
  }

  flushPendingWrites() {
    if (this.terminalsPersistTimer) {
      clearTimeout(this.terminalsPersistTimer)
      this.terminalsPersistTimer = null
    }
    if (!this.pendingTerminals) return
    const terminals = this.pendingTerminals
    this.store.set('terminals', this.normalizeTerminals(terminals))
    this.pendingTerminals = null
  }

  upsertTerminal(session: TerminalSession) {
    const sessions = this.getTerminals()
    const index = sessions.findIndex((item) => item.id === session.id)
    if (index >= 0) {
      sessions[index] = session
    } else {
      sessions.unshift(session)
    }
    this.setTerminals([...sessions].slice(0, 18))
  }

  deleteTerminal(sessionId: string) {
    this.setTerminals(this.getTerminals().filter((session) => session.id !== sessionId))
  }

  getSettings(): AppSettings {
    return normalizeSettings({ ...this.store.get('settings'), preferredShell: this.getPreferredShell() })
  }

  updateSettings(patch: Partial<AppSettings>) {
    const settings = normalizeSettings({ ...this.getSettings(), ...patch })
    if (patch.nodeCaCertificate && settings.nodeCaCertificate && (!existsSync(settings.nodeCaCertificate) || !statSync(settings.nodeCaCertificate).isFile())) {
      throw new Error('Choose an existing CA certificate file.')
    }
    this.store.set('settings', settings)
    return this.getSettings()
  }

  getPreferredShell() {
    return normalizePreferredShell(this.store.get('settings')?.preferredShell)
  }

  getWindowBounds(): WindowBounds {
    return this.windowStore.get('bounds')
      ?? this.store.get('settings')?.windowBounds
      ?? DEFAULT_WINDOW_BOUNDS
  }

  setWindowBounds(windowBounds: WindowBounds) {
    if (windowBoundsEqual(this.getWindowBounds(), windowBounds)) return
    this.windowStore.set('bounds', windowBounds)
  }
}
