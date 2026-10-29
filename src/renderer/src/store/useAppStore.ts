import { normalizeSettings } from '@shared/settings'
import { normalizeUiState, visibleConsoleSessions, UNGROUPED_KEY } from '@shared/navigation'
import { startTransition, useMemo } from 'react'
import { create } from 'zustand'
import {
  workspaceGetDetailsCleanupWorktreesKey,
  workspaceGetDetailsConvertWorktreesKey,
  workspaceGetDetailsCreateWorktreeKey,
  workspaceGetDetailsRemoveWorktreeKey
} from '@shared/gitWorktreeBridge'
import { createRafBatch } from '@shared/debounce'
import { appendTerminalBuffer, containsDomRendererLeak } from '@shared/terminalBuffer'
import { normalizeComparePath, resolveMainWorktreePath, resolveSelectedWorktreePath } from '@shared/worktreeExecution'
import { normalizeWorkspaceRecord } from '@shared/workspaceModel'
import { moveWorkspaceToGroup, sortByOrder, sortWorkspacesForSidebar, workspacesInGroup } from '@shared/workspaceGroups'
import {
  type AppSettings,
  type OpenTarget,
  type UiState,
  type GroupRecord,
  type CleanupGitWorktreesInput,
  type CleanupGitWorktreesResult,
  type CreateGitWorktreeInput,
  type CommandListResponse,
  type DockerCommandListResponse,
  type WorkspaceCandidate,
  type WorkspaceRecord,
  type PinnedEndpoint,
  type QuickLink,
  type RemoveGitWorktreeInput,
  type RemoveGitWorktreeResult,
  type RunAction,
  type TerminalExitEvent,
  type TerminalOutputEvent,
  type TerminalSession
} from '@shared/types'

async function convertRepoToWorktreesViaApi(workspaceId: string): Promise<WorkspaceRecord> {
  const { git, workspaces } = window.workspaceApi
  if (typeof git.convertRepoToWorktrees === 'function') {
    const { workspace } = await git.convertRepoToWorktrees(workspaceId)
    return workspace
  }

  const workspace = await workspaces.getDetails(workspaceGetDetailsConvertWorktreesKey(workspaceId))
  if (!workspace) throw new Error('Workspace not found.')
  return workspace
}

async function createGitWorktreeViaApi(input: CreateGitWorktreeInput): Promise<WorkspaceRecord> {
  const { git, workspaces } = window.workspaceApi
  if (typeof git.createWorktree === 'function') {
    const { workspace } = await git.createWorktree(input)
    return workspace
  }

  const workspace = await workspaces.getDetails(workspaceGetDetailsCreateWorktreeKey(input))
  if (!workspace) throw new Error('Workspace not found.')
  return workspace
}

async function cleanupGitWorktreesViaApi(input: CleanupGitWorktreesInput): Promise<CleanupGitWorktreesResult> {
  const { git, workspaces } = window.workspaceApi
  if (typeof git.cleanupWorktrees === 'function') {
    return git.cleanupWorktrees(input)
  }

  const workspace = await workspaces.getDetails(workspaceGetDetailsCleanupWorktreesKey(input))
  if (!workspace) throw new Error('Workspace not found.')
  return { workspace, removedPaths: [], skipped: [], errors: [] }
}

async function removeGitWorktreeViaApi(input: RemoveGitWorktreeInput): Promise<RemoveGitWorktreeResult> {
  const { git, workspaces } = window.workspaceApi
  if (typeof git.removeWorktree === 'function') {
    return git.removeWorktree(input)
  }

  const workspace = await workspaces.getDetails(workspaceGetDetailsRemoveWorktreeKey(input))
  if (!workspace) throw new Error('Workspace not found.')
  return { workspace, worktreePath: input.worktreePath }
}

interface AppState {
  settings: AppSettings
  settingsOpen: boolean
  setSettingsOpen: (value: boolean) => void
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  setWorkspaceOpenTarget: (workspaceId: string, target: OpenTarget | null) => Promise<void>
  groups: GroupRecord[]
  migrationNotes: string[]
  dismissMigrationNotes: () => Promise<void>
  handleWorkspaceUpdate: (workspace: WorkspaceRecord) => Promise<void>
  workspaces: WorkspaceRecord[]
  /** Group of the selected workspace ('all' when ungrouped); new imports default to it. */
  selectedGroupId: string
  /** Collapsed sidebar sections: group ids, or UNGROUPED_KEY. */
  collapsedGroupIds: string[]
  selectedWorkspaceId: string | null
  selectedWorktreeByWorkspace: Record<string, string>
  sidebarCollapsed: boolean
  consoleTabFilter: UiState['consoleTabFilter']
  toggleConsoleTabFilter: () => void
  consoleFullscreen: boolean
  scriptsPanelOpen: boolean
  search: string
  commandLists: Record<string, CommandListResponse>
  dockerLists: Record<string, DockerCommandListResponse>
  terminals: TerminalSession[]
  activeTerminalId: string | null
  importCandidates: WorkspaceCandidate[]
  importDrawerOpen: boolean
  bootstrapped: boolean
  lastActionError: string | null
  bootstrap: () => Promise<void>
  toggleSidebar: () => void
  toggleConsoleFullscreen: () => void
  setConsoleFullscreen: (value: boolean) => void
  toggleScriptsPanel: () => void
  setSearch: (value: string) => void
  setSelectedGroup: (groupId: string) => void
  toggleGroupCollapsed: (key: string) => void
  setSelectedWorkspace: (workspaceId: string | null) => Promise<void>
  setSelectedWorktree: (workspaceId: string, worktreePath: string) => void
  getSelectedWorktreePath: (workspaceId: string) => string | null
  createGroup: (name: string) => Promise<void>
  renameGroup: (groupId: string, name: string) => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  moveGroup: (groupId: string, direction: -1 | 1) => Promise<void>
  setGroupColor: (groupId: string, color: string | null) => Promise<void>
  importWorkspaces: (mode: 'folders' | 'parent') => Promise<void>
  applyImportSelection: (selectedRootPaths: string[], groupId: string | null) => Promise<void>
  importWorkspacePaths: (rootPaths: string[], groupId: string | null) => Promise<void>
  dismissImportDrawer: () => void
  rescanWorkspace: (workspaceId: string) => Promise<void>
  convertRepoToWorktrees: (workspaceId: string) => Promise<void>
  createGitWorktree: (workspaceId: string, branch: string, createBranch: boolean) => Promise<void>
  cleanupGitWorktrees: (input: CleanupGitWorktreesInput) => Promise<string[]>
  removeGitWorktree: (workspaceId: string, worktreePath: string) => Promise<void>
  importAllGitWorktrees: (workspaceId: string) => Promise<void>
  removeWorkspace: (workspaceId: string) => Promise<void>
  /** Move up or down within the workspace's own group. */
  moveWorkspace: (workspaceId: string, direction: -1 | 1) => Promise<void>
  /** Move into `groupId` (null = ungrouped) at `index` within that group. */
  moveWorkspaceTo: (workspaceId: string, groupId: string | null, index: number) => Promise<void>
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>
  runCommand: (commandId: string) => Promise<void>
  runCustomAction: (workspaceId: string, actionId: string) => Promise<void>
  runDockerCommand: (commandId: string) => Promise<void>
  stopTerminal: (sessionId: string) => Promise<void>
  stopAllTerminals: () => Promise<void>
  pauseWorkspaceTerminals: (workspaceId: string) => Promise<void>
  resumeWorkspaceTerminals: (workspaceId: string) => Promise<void>
  pauseGroupTerminals: (groupId: string) => Promise<void>
  resumeGroupTerminals: (groupId: string) => Promise<void>
  killGroupTerminals: (groupId: string) => Promise<void>
  toggleWorkspacePause: (workspaceId: string) => Promise<void>
  restartTerminal: (sessionId: string) => Promise<void>
  toggleActiveTerminalRunState: () => Promise<void>
  cycleActiveTerminal: (direction: -1 | 1) => void
  clearTerminal: (sessionId: string) => Promise<void>
  removeTerminal: (sessionId: string) => Promise<void>
  renameTerminal: (sessionId: string, title: string) => Promise<void>
  togglePinTerminal: (sessionId: string) => Promise<void>
  setActiveTerminal: (sessionId: string | null) => void
  toggleFavoriteCommand: (workspaceId: string, commandId: string) => Promise<void>
  setCommandChain: (workspaceId: string, commandId: string, prerequisiteIds: string[]) => Promise<void>
  saveRunConfiguration: (workspaceId: string, actions: RunAction[], defaultActionId: string | null) => Promise<void>
  savePinnedEndpoints: (workspaceId: string, endpoints: PinnedEndpoint[]) => Promise<void>
  togglePinnedEndpoint: (workspaceId: string, endpoint: PinnedEndpoint) => Promise<void>
  saveLink: (workspaceId: string, link: { id?: string; label: string; url: string }) => Promise<void>
  deleteLink: (workspaceId: string, linkId: string) => Promise<void>
  handleTerminalOutput: (event: TerminalOutputEvent) => void
  handleTerminalExit: (event: TerminalExitEvent) => void
  clearActionError: () => void
}

function sortGroups(groups: GroupRecord[]) {
  return sortByOrder(groups)
}

function replaceWorkspace(workspaces: WorkspaceRecord[], nextWorkspace: WorkspaceRecord) {
  const normalized = normalizeWorkspaceRecord(nextWorkspace)
  const index = workspaces.findIndex((workspace) => workspace.id === normalized.id)
  if (index === -1) return [...workspaces, normalized]
  const copy = [...workspaces]
  copy[index] = normalized
  return copy
}

function applyRemovedWorktrees(
  state: Pick<AppState, 'workspaces' | 'selectedWorkspaceId' | 'selectedWorktreeByWorkspace' | 'activeTerminalId' | 'terminals'>,
  workspace: WorkspaceRecord,
  removedPaths: string[],
  terminals: TerminalSession[]
) {
  const removed = new Set(removedPaths.map((path) => normalizeComparePath(path)))
  const selectedWorktreeByWorkspace = { ...state.selectedWorktreeByWorkspace }
  const selected = selectedWorktreeByWorkspace[workspace.id]
  if (selected && removed.has(normalizeComparePath(selected))) {
    selectedWorktreeByWorkspace[workspace.id] = resolveMainWorktreePath(workspace)
  }

  let selectedWorkspaceId = state.selectedWorkspaceId
  const workspaces = replaceWorkspace(state.workspaces, workspace).filter((entry) => {
    if (entry.id === workspace.id) return true
    const drop = removed.has(normalizeComparePath(entry.rootPath))
    if (drop && selectedWorkspaceId === entry.id) selectedWorkspaceId = workspace.id
    return !drop
  })

  const activeTerminalId = terminals.some((terminal) => terminal.id === state.activeTerminalId)
    ? state.activeTerminalId
    : terminals[0]?.id ?? null

  return {
    workspaces,
    selectedWorkspaceId,
    selectedWorktreeByWorkspace,
    terminals,
    activeTerminalId,
    lastActionError: null as string | null
  }
}

function sortTerminals(terminals: TerminalSession[]) {
  return [...terminals].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    return right.updatedAt - left.updatedAt
  })
}

function replaceTerminal(terminals: TerminalSession[], nextSession: TerminalSession) {
  const index = terminals.findIndex((session) => session.id === nextSession.id)
  if (index === -1) return sortTerminals([nextSession, ...terminals])
  const copy = [...terminals]
  copy[index] = nextSession
  return sortTerminals(copy)
}

function resolveActiveTerminalId(terminals: TerminalSession[], currentActiveId: string | null) {
  if (currentActiveId && terminals.some((session) => session.id === currentActiveId)) {
    return currentActiveId
  }
  return terminals[0]?.id ?? null
}

function terminalsForWorkspace(terminals: TerminalSession[], workspaceId: string | null) {
  if (!workspaceId) return []
  return terminals.filter((session) => session.workspaceId === workspaceId)
}

export { UNGROUPED_KEY }

export function visibleTerminals(state: Pick<AppState, 'terminals' | 'workspaces' | 'selectedWorkspaceId' | 'selectedWorktreeByWorkspace' | 'consoleTabFilter'>) {
  return visibleConsoleSessions(state.terminals, state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId),
    state.consoleTabFilter, state.selectedWorkspaceId ? state.selectedWorktreeByWorkspace[state.selectedWorkspaceId] : undefined)
}

function navigationState(state: UiState): UiState {
  return {
    selectedGroupId: state.selectedGroupId, selectedWorkspaceId: state.selectedWorkspaceId,
    selectedWorktreeByWorkspace: state.selectedWorktreeByWorkspace, sidebarCollapsed: state.sidebarCollapsed,
    collapsedGroupIds: state.collapsedGroupIds, consoleTabFilter: state.consoleTabFilter
  }
}

export const useAppStore = create<AppState>((set, get) => {
  const queueTerminalOutput = createRafBatch<TerminalOutputEvent>((events) => {
    const chunks = new Map<string, string>()
    for (const event of events) {
      chunks.set(event.sessionId, `${chunks.get(event.sessionId) ?? ''}${event.chunk}`)
    }

    const updatedAt = Date.now()
    set((state) => ({
      terminals: state.terminals.map((session) => {
        const chunk = chunks.get(session.id)
        if (!chunk) return session
        return {
          ...session,
          buffer: appendTerminalBuffer(session.buffer, chunk),
          updatedAt
        }
      })
    }))
  })

  return {
  settings: normalizeSettings(), settingsOpen: false,
  setSettingsOpen(value) { set({ settingsOpen: value }) },
  async saveSettings(patch) { set({ settings: await window.workspaceApi.settings.update(patch) }) },
  async setWorkspaceOpenTarget(workspaceId, target) {
    const workspace = await window.workspaceApi.workspaces.setOpenTarget(workspaceId, target)
    if (workspace) set((state) => ({ workspaces: replaceWorkspace(state.workspaces, workspace) }))
  },
  groups: [],
  migrationNotes: [],
  workspaces: [],
  selectedGroupId: 'all',
  collapsedGroupIds: [],
  selectedWorkspaceId: null,
  selectedWorktreeByWorkspace: {},
  sidebarCollapsed: true,
  consoleTabFilter: 'all',
  toggleConsoleTabFilter() {
    set((state) => ({ consoleTabFilter: state.consoleTabFilter === 'all' ? 'worktree' : 'all' }))
  },
  consoleFullscreen: false,
  scriptsPanelOpen: true,
  search: '',
  commandLists: {},
  dockerLists: {},
  terminals: [],
  activeTerminalId: null,
  importCandidates: [],
  importDrawerOpen: false,
  bootstrapped: false,
  lastActionError: null,
  async bootstrap() {
    const [groups, workspaces, terminals, migrationNotes, savedUi, settings] = await Promise.all([
      window.workspaceApi.groups.list(),
      window.workspaceApi.workspaces.list(),
      window.workspaceApi.terminals.restore(),
      window.workspaceApi.system.migrationNotes(),
      window.workspaceApi.ui.get(),
      window.workspaceApi.settings?.get() ?? Promise.resolve(normalizeSettings())
    ])
    const sortedTerminals = sortTerminals(terminals)
    const ui = normalizeUiState(savedUi, groups, workspaces)
    const selectedWorkspace = workspaces.find((workspace) => workspace.id === ui.selectedWorkspaceId)

    startTransition(() => {
      const visible = visibleConsoleSessions(sortedTerminals, selectedWorkspace, ui.consoleTabFilter, selectedWorkspace ? ui.selectedWorktreeByWorkspace[selectedWorkspace.id] : undefined)
      set({
        groups: sortGroups(groups),
        settings,
        migrationNotes,
        workspaces: workspaces.map(normalizeWorkspaceRecord),
        terminals: sortedTerminals,
        bootstrapped: true,
        ...ui,
        activeTerminalId: resolveActiveTerminalId(visible, get().activeTerminalId)
      })
    })

    if (selectedWorkspace) {
      const [commandList, dockerList] = await Promise.all([
        window.workspaceApi.commands.list(selectedWorkspace.id),
        window.workspaceApi.docker.list(selectedWorkspace.id)
      ])
      set((state) => ({
        commandLists: {
          ...state.commandLists,
          [selectedWorkspace.id]: commandList
        },
        dockerLists: {
          ...state.dockerLists,
          [selectedWorkspace.id]: dockerList
        }
      }))
    }
    await window.workspaceApi.workspaces.startupRescan()
  },
  async dismissMigrationNotes() {
    try {
      await window.workspaceApi.system.clearMigrationNotes()
      set({ migrationNotes: [] })
    } catch (error) {
      set({ lastActionError: error instanceof Error ? error.message : String(error) })
    }
  },
  async handleWorkspaceUpdate(workspace) {
    if (!get().workspaces.some((entry) => entry.id === workspace.id)) return
    set((state) => ({ workspaces: replaceWorkspace(state.workspaces, workspace) }))
    try {
      const [commands, docker] = await Promise.all([
        window.workspaceApi.commands.list(workspace.id), window.workspaceApi.docker.list(workspace.id)
      ])
      if (!get().workspaces.some((entry) => entry.id === workspace.id)) return
      set((state) => ({ commandLists: { ...state.commandLists, [workspace.id]: commands }, dockerLists: { ...state.dockerLists, [workspace.id]: docker } }))
    } catch (error) {
      set({ lastActionError: error instanceof Error ? error.message : String(error) })
    }
  },
  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },
  toggleConsoleFullscreen() {
    set((state) => ({ consoleFullscreen: !state.consoleFullscreen }))
  },
  setConsoleFullscreen(value) {
    set({ consoleFullscreen: value })
  },
  toggleScriptsPanel() {
    set((state) => ({ scriptsPanelOpen: !state.scriptsPanelOpen }))
  },
  clearActionError() {
    set({ lastActionError: null })
  },
  setSearch(value) {
    set({ search: value })
  },
  setSelectedGroup(groupId) {
    startTransition(() => {
      set({ selectedGroupId: groupId })
    })
  },
  toggleGroupCollapsed(key) {
    set((state) => ({
      collapsedGroupIds: state.collapsedGroupIds.includes(key)
        ? state.collapsedGroupIds.filter((entry) => entry !== key)
        : [...state.collapsedGroupIds, key]
    }))
  },
  setSelectedWorktree(workspaceId, worktreePath) {
    const workspace = get().workspaces.find((entry) => entry.id === workspaceId)
    if (!workspace) return
    set((state) => ({
      selectedWorktreeByWorkspace: {
        ...state.selectedWorktreeByWorkspace,
        [workspaceId]: resolveSelectedWorktreePath(workspace, worktreePath)
      }
    }))
  },
  getSelectedWorktreePath(workspaceId) {
    const workspace = get().workspaces.find((entry) => entry.id === workspaceId)
    if (!workspace) return null
    return resolveSelectedWorktreePath(workspace, get().selectedWorktreeByWorkspace[workspaceId])
  },
  async setSelectedWorkspace(workspaceId) {
    const workspace = workspaceId ? get().workspaces.find((entry) => entry.id === workspaceId) : null
    const defaultWorktreePath = workspace ? resolveMainWorktreePath(workspace) : null
    set((state) => ({
      selectedWorkspaceId: workspaceId,
      selectedGroupId: workspace?.groupId ?? 'all',
      selectedWorktreeByWorkspace:
        workspaceId && defaultWorktreePath && !state.selectedWorktreeByWorkspace[workspaceId]
          ? { ...state.selectedWorktreeByWorkspace, [workspaceId]: defaultWorktreePath }
          : state.selectedWorktreeByWorkspace,
      activeTerminalId: terminalsForWorkspace(state.terminals, workspaceId)[0]?.id ?? null,
      consoleFullscreen: false
    }))
    if (!workspaceId || (get().commandLists[workspaceId] && get().dockerLists[workspaceId])) return
    const [commands, docker] = await Promise.all([
      window.workspaceApi.commands.list(workspaceId),
      window.workspaceApi.docker.list(workspaceId)
    ])
    set((state) => ({
      commandLists: {
        ...state.commandLists,
        [workspaceId]: commands
      },
      dockerLists: {
        ...state.dockerLists,
        [workspaceId]: docker
      }
    }))
  },
  async createGroup(name) {
    const group = await window.workspaceApi.groups.create({ name })
    set((state) => ({
      groups: sortGroups([...state.groups, group]),
      selectedGroupId: group.id
    }))
  },
  async renameGroup(groupId, name) {
    const nextName = name.trim()
    if (!nextName) return
    const group = await window.workspaceApi.groups.update({ id: groupId, name: nextName })
    if (!group) return
    set((state) => ({
      groups: sortGroups(state.groups.map((item) => item.id === groupId ? group : item))
    }))
  },
  async deleteGroup(groupId) {
    const workspaces = await window.workspaceApi.groups.delete(groupId)
    set((state) => ({
      groups: sortGroups(state.groups.filter((group) => group.id !== groupId)),
      selectedGroupId: state.selectedGroupId === groupId ? 'all' : state.selectedGroupId,
      collapsedGroupIds: state.collapsedGroupIds.filter((entry) => entry !== groupId),
      workspaces: workspaces.map(normalizeWorkspaceRecord)
    }))
  },
  async setGroupColor(groupId, color) {
    try {
      const group = await window.workspaceApi.groups.update({ id: groupId, color })
      if (!group) return
      set((state) => ({ groups: sortGroups(state.groups.map((item) => (item.id === groupId ? group : item))) }))
    } catch (error) {
      set({ lastActionError: error instanceof Error ? error.message : String(error) })
    }
  },
  async moveGroup(groupId, direction) {
    const groups = sortGroups(get().groups)
    const index = groups.findIndex((group) => group.id === groupId)
    if (index === -1) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= groups.length) return
    const reordered = [...groups]
    ;[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]]
    const nextGroups = await window.workspaceApi.groups.reorder({ ids: reordered.map((group) => group.id) })
    set({
      groups: sortGroups(nextGroups)
    })
  },
  async importWorkspaces(mode) {
    const importCandidates = await window.workspaceApi.workspaces.importCandidates({ mode })
    if (importCandidates.length === 0) return
    set({ importCandidates, importDrawerOpen: true })
  },
  async applyImportSelection(selectedRootPaths, groupId) {
    const candidates = get().importCandidates.filter((candidate) => selectedRootPaths.includes(candidate.rootPath))
    if (candidates.length === 0) return
    const workspaces = await window.workspaceApi.workspaces.add({ candidates, groupId })
    const selectedWorkspace = workspaces[0] ?? null
    if (selectedWorkspace) {
      const [commands, docker] = await Promise.all([
        window.workspaceApi.commands.list(selectedWorkspace.id),
        window.workspaceApi.docker.list(selectedWorkspace.id)
      ])
      set((state) => ({
        terminals: state.terminals,
        workspaces: uniqueWorkspaces(state.workspaces, workspaces),
        importCandidates: [],
        importDrawerOpen: false,
        selectedWorkspaceId: selectedWorkspace.id,
        activeTerminalId: terminalsForWorkspace(state.terminals, selectedWorkspace.id)[0]?.id ?? null,
        commandLists: {
          ...state.commandLists,
          [selectedWorkspace.id]: commands
        },
        dockerLists: {
          ...state.dockerLists,
          [selectedWorkspace.id]: docker
        }
      }))
      return
    }
    set((state) => ({
      workspaces: uniqueWorkspaces(state.workspaces, workspaces),
      importCandidates: [],
      importDrawerOpen: false
    }))
  },
  async importWorkspacePaths(rootPaths, groupId) {
    if (rootPaths.length === 0) return
    const candidates = await window.workspaceApi.workspaces.importCandidates({ mode: 'paths', paths: rootPaths })
    if (candidates.length === 0) return
    const workspaces = await window.workspaceApi.workspaces.add({ candidates, groupId })
    const selectedWorkspace = workspaces[0] ?? null
    set((state) => {
      const nextState: Partial<AppState> = {
        workspaces: uniqueWorkspaces(state.workspaces, workspaces)
      }
      if (selectedWorkspace) {
        nextState.selectedWorkspaceId = selectedWorkspace.id
        nextState.activeTerminalId = terminalsForWorkspace(state.terminals, selectedWorkspace.id)[0]?.id ?? null
      }
      return nextState
    })
    if (selectedWorkspace) {
      const [commands, docker] = await Promise.all([
        window.workspaceApi.commands.list(selectedWorkspace.id),
        window.workspaceApi.docker.list(selectedWorkspace.id)
      ])
      set((state) => ({
        commandLists: {
          ...state.commandLists,
          [selectedWorkspace.id]: commands
        },
        dockerLists: {
          ...state.dockerLists,
          [selectedWorkspace.id]: docker
        }
      }))
    }
  },
  dismissImportDrawer() {
    set({ importCandidates: [], importDrawerOpen: false })
  },
  async rescanWorkspace(workspaceId) {
    const workspace = await window.workspaceApi.workspaces.rescan(workspaceId)
    if (!workspace) return
    const [commands, docker] = await Promise.all([
      window.workspaceApi.commands.list(workspaceId),
      window.workspaceApi.docker.list(workspaceId)
    ])
    set((state) => ({
      workspaces: replaceWorkspace(state.workspaces, workspace),
      commandLists: {
        ...state.commandLists,
        [workspaceId]: commands
      },
      dockerLists: {
        ...state.dockerLists,
        [workspaceId]: docker
      }
    }))
  },
  async convertRepoToWorktrees(workspaceId) {
    try {
      const workspace = await convertRepoToWorktreesViaApi(workspaceId)
      set((state) => ({
        workspaces: replaceWorkspace(state.workspaces, workspace),
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to set up git worktrees.'
      })
    }
  },
  async createGitWorktree(workspaceId, branch, createBranch) {
    try {
      const workspace = await createGitWorktreeViaApi({ workspaceId, branch, createBranch })
      set((state) => ({
        workspaces: replaceWorkspace(state.workspaces, workspace),
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to create git worktree.'
      })
    }
  },
  async cleanupGitWorktrees(input) {
    try {
      const result = await cleanupGitWorktreesViaApi(input)
      const terminals = await window.workspaceApi.terminals.list()
      set((state) => ({
        ...applyRemovedWorktrees(state, result.workspace, result.removedPaths, terminals),
        lastActionError: result.errors.length > 0 ? result.errors.join('\n') : null
      }))
      return result.removedPaths
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to clean up git worktrees.'
      })
      throw error
    }
  },
  async removeGitWorktree(workspaceId, worktreePath) {
    try {
      const result = await removeGitWorktreeViaApi({ workspaceId, worktreePath })
      const terminals = await window.workspaceApi.terminals.list()
      set((state) => applyRemovedWorktrees(state, result.workspace, [result.worktreePath], terminals))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to remove git worktree.'
      })
      throw error
    }
  },
  async importAllGitWorktrees(workspaceId) {
    const workspace = get().workspaces.find((entry) => entry.id === workspaceId)
    if (!workspace) return
    const linkedPaths = new Set(get().workspaces.map((entry) => entry.rootPath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()))
    const paths = (workspace.gitWorktrees ?? [])
      .filter((worktree) => !worktree.isBare)
      .map((worktree) => worktree.path)
      .filter((path) => !linkedPaths.has(path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()))
    if (paths.length === 0) return
    await get().importWorkspacePaths(paths, workspace.groupId)
  },
  async moveWorkspace(workspaceId, direction) {
    const workspace = get().workspaces.find((entry) => entry.id === workspaceId)
    if (!workspace) return
    const siblings = workspacesInGroup(get().workspaces, workspace.groupId)
    const nextIndex = siblings.findIndex((entry) => entry.id === workspaceId) + direction
    if (nextIndex < 0 || nextIndex >= siblings.length) return
    await get().moveWorkspaceTo(workspaceId, workspace.groupId, nextIndex)
  },
  async moveWorkspaceTo(workspaceId, groupId, index) {
    const previous = get().workspaces
    // Apply locally first so a drag lands immediately; the main process result is authoritative.
    set({ workspaces: moveWorkspaceToGroup(previous, { workspaceId, groupId, index }) })
    try {
      const workspaces = await window.workspaceApi.workspaces.move({ workspaceId, groupId, index })
      set({ workspaces: workspaces.map(normalizeWorkspaceRecord) })
    } catch (error) {
      set({ workspaces: previous, lastActionError: error instanceof Error ? error.message : String(error) })
    }
  },
  async renameWorkspace(workspaceId, name) {
    const workspace = await window.workspaceApi.workspaces.rename({ workspaceId, name })
    if (!workspace) return
    set((state) => ({
      workspaces: replaceWorkspace(state.workspaces, workspace)
    }))
  },
  async removeWorkspace(workspaceId) {
    const state = get()
    const workspaceTerminalIds = state.terminals
      .filter((session) => session.workspaceId === workspaceId)
      .map((session) => session.id)
    await Promise.all(workspaceTerminalIds.map((sessionId) => window.workspaceApi.terminals.remove(sessionId).catch(() => undefined)))
    await window.workspaceApi.workspaces.remove(workspaceId)
    set((current) => {
      const workspaces = current.workspaces.filter((workspace) => workspace.id !== workspaceId)
      const terminals = current.terminals.filter((session) => session.workspaceId !== workspaceId)
      const selectedWorkspaceId = current.selectedWorkspaceId === workspaceId ? workspaces[0]?.id ?? null : current.selectedWorkspaceId
      return {
        workspaces,
        terminals,
        selectedWorkspaceId,
        activeTerminalId: resolveActiveTerminalId(terminalsForWorkspace(terminals, selectedWorkspaceId), current.activeTerminalId),
        commandLists: Object.fromEntries(Object.entries(current.commandLists).filter(([id]) => id !== workspaceId)),
        dockerLists: Object.fromEntries(Object.entries(current.dockerLists).filter(([id]) => id !== workspaceId))
      }
    })
  },
  async runCommand(commandId) {
    try {
      const { selectedWorkspaceId, workspaces, selectedWorktreeByWorkspace } = get()
      const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId)
      const worktreePath = workspace ? resolveSelectedWorktreePath(workspace, selectedWorktreeByWorkspace[workspace.id]) : null
      const session = await window.workspaceApi.commands.run({ commandId, worktreePath })
      set((state) => ({
        terminals: replaceTerminal(state.terminals, session),
        activeTerminalId: session.id,
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to run command.'
      })
    }
  },
  async runCustomAction(workspaceId, actionId) {
    try {
      const { workspaces, selectedWorktreeByWorkspace } = get()
      const workspace = workspaces.find((entry) => entry.id === workspaceId)
      if (!workspace) return
      const worktreePath = resolveSelectedWorktreePath(workspace, selectedWorktreeByWorkspace[workspace.id])
      const session = await window.workspaceApi.commands.runCustom({ workspaceId, actionId, worktreePath })
      set((state) => ({
        terminals: replaceTerminal(state.terminals, session),
        activeTerminalId: session.id,
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to run custom action.'
      })
    }
  },
  async runDockerCommand(commandId) {
    try {
      const { selectedWorkspaceId, workspaces, selectedWorktreeByWorkspace } = get()
      const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId)
      const worktreePath = workspace ? resolveSelectedWorktreePath(workspace, selectedWorktreeByWorkspace[workspace.id]) : null
      const session = await window.workspaceApi.docker.run({ commandId, worktreePath })
      set((state) => ({
        terminals: replaceTerminal(state.terminals, session),
        activeTerminalId: session.id,
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to run docker command.'
      })
    }
  },
  async stopTerminal(sessionId) {
    const session = await window.workspaceApi.terminals.stop(sessionId)
    if (!session) return
    set((state) => ({
      terminals: replaceTerminal(state.terminals, session)
    }))
  },
  async stopAllTerminals() {
    const stopped = await window.workspaceApi.terminals.stopAll()
    if (stopped.length === 0) return
    set((state) => ({
      terminals: stopped.reduce((terminals, session) => replaceTerminal(terminals, session), state.terminals),
      lastActionError: null
    }))
  },
  async pauseWorkspaceTerminals(workspaceId) {
    try {
      const paused = await window.workspaceApi.terminals.pauseWorkspace(workspaceId)
      if (paused.length === 0) return
      set((state) => ({
        terminals: paused.reduce((terminals, session) => replaceTerminal(terminals, session), state.terminals),
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to pause workspace consoles.'
      })
    }
  },
  async resumeWorkspaceTerminals(workspaceId) {
    try {
      const { sessions: resumed, warnings } = await window.workspaceApi.terminals.resumeWorkspace(workspaceId)
      set((state) => ({
        terminals: resumed.reduce((terminals, session) => replaceTerminal(terminals, session), state.terminals),
        activeTerminalId: state.activeTerminalId ?? resumed[0]?.id ?? null,
        lastActionError: warnings.join('\n') || null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to resume workspace consoles.'
      })
    }
  },
  async pauseGroupTerminals(groupId) {
    try {
      const sessions = await window.workspaceApi.terminals.pauseGroup(groupId)
      set((state) => ({ terminals: sessions.reduce((all, session) => replaceTerminal(all, session), state.terminals), lastActionError: null }))
    } catch (error) {
      set({ lastActionError: error instanceof Error ? error.message : String(error) })
    }
  },
  async resumeGroupTerminals(groupId) {
    try {
      const { sessions, warnings } = await window.workspaceApi.terminals.resumeGroup(groupId)
      set((state) => ({
        terminals: sessions.reduce((all, session) => replaceTerminal(all, session), state.terminals),
        lastActionError: warnings.join('\n') || null
      }))
    } catch (error) {
      set({ lastActionError: error instanceof Error ? error.message : String(error) })
    }
  },
  async killGroupTerminals(groupId) {
    try {
      const sessions = await window.workspaceApi.terminals.killGroup(groupId)
      const removed = new Set(sessions.map((session) => session.id))
      set((state) => {
        const terminals = state.terminals.filter((session) => !removed.has(session.id))
        return { terminals, activeTerminalId: resolveActiveTerminalId(visibleTerminals({ ...state, terminals }), state.activeTerminalId), lastActionError: null }
      })
    } catch (error) {
      set({ lastActionError: error instanceof Error ? error.message : String(error) })
    }
  },
  async toggleWorkspacePause(workspaceId) {
    const workspaceTerminals = get().terminals.filter((session) => session.workspaceId === workspaceId)
    if (workspaceTerminals.some((session) => session.status === 'running')) {
      await get().pauseWorkspaceTerminals(workspaceId)
      return
    }
    if (workspaceTerminals.some((session) => session.workspacePaused)) {
      await get().resumeWorkspaceTerminals(workspaceId)
    }
  },
  async toggleActiveTerminalRunState() {
    const { activeTerminalId } = get()
    const workspaceTerminals = visibleTerminals(get())
    const session =
      workspaceTerminals.find((item) => item.id === activeTerminalId) ?? workspaceTerminals[0] ?? null
    if (!session) return
    if (session.status === 'running') {
      await get().stopTerminal(session.id)
      return
    }
    await get().restartTerminal(session.id)
  },
  cycleActiveTerminal(direction) {
    const { activeTerminalId } = get()
    const workspaceTerminals = visibleTerminals(get())
    if (workspaceTerminals.length === 0) return
    const currentIndex = workspaceTerminals.findIndex((session) => session.id === activeTerminalId)
    const startIndex = currentIndex === -1 ? 0 : currentIndex
    const nextIndex = (startIndex + direction + workspaceTerminals.length) % workspaceTerminals.length
    set({ activeTerminalId: workspaceTerminals[nextIndex].id })
  },
  async restartTerminal(sessionId) {
    const current = get().terminals.find((session) => session.id === sessionId)
    if (!current) return
    try {
      const session = await window.workspaceApi.terminals.restart(sessionId)
      if (!session) return
      set((state) => ({
        terminals: replaceTerminal(state.terminals, session),
        activeTerminalId: session.id,
        lastActionError: null
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restart console.'
      if (message.includes("No handler registered for 'terminals.restart'")) {
        try {
          const session = current.commandId.includes('::docker::')
            ? await window.workspaceApi.docker.run({ commandId: current.commandId, worktreePath: current.worktreePath })
            : await window.workspaceApi.commands.run({ commandId: current.commandId, worktreePath: current.worktreePath })

          await window.workspaceApi.terminals.remove(sessionId).catch(() => undefined)

          set((state) => ({
            terminals: replaceTerminal(state.terminals.filter((item) => item.id !== sessionId), session),
            activeTerminalId: session.id,
            lastActionError: null
          }))
          return
        } catch (fallbackError) {
          set({
            lastActionError: fallbackError instanceof Error ? fallbackError.message : 'Failed to replay console.'
          })
          return
        }
      }

      set({
        lastActionError: message
      })
    }
  },
  async clearTerminal(sessionId) {
    const session = await window.workspaceApi.terminals.clear(sessionId)
    if (!session) return
    set((state) => ({
      terminals: replaceTerminal(state.terminals, session)
    }))
  },
  async removeTerminal(sessionId) {
    await window.workspaceApi.terminals.remove(sessionId)
    set((state) => {
      const terminals = state.terminals.filter((session) => session.id !== sessionId)
      return {
        terminals,
        activeTerminalId: resolveActiveTerminalId(terminals, state.activeTerminalId === sessionId ? null : state.activeTerminalId)
      }
    })
  },
  async renameTerminal(sessionId, title) {
    const session = await window.workspaceApi.terminals.rename({ sessionId, title })
    if (!session) return
    set((state) => ({
      terminals: replaceTerminal(state.terminals, session)
    }))
  },
  async togglePinTerminal(sessionId) {
    const session = await window.workspaceApi.terminals.togglePin(sessionId)
    if (!session) return
    set((state) => ({
      terminals: replaceTerminal(state.terminals, session),
      activeTerminalId: state.activeTerminalId ?? session.id
    }))
  },
  setActiveTerminal(sessionId) {
    set({ activeTerminalId: sessionId })
  },
  async toggleFavoriteCommand(workspaceId, commandId) {
    const workspace = await window.workspaceApi.workspaces.toggleFavoriteCommand({ workspaceId, commandId })
    if (!workspace) return
    const commands = await window.workspaceApi.commands.list(workspaceId)
    set((state) => ({
      workspaces: replaceWorkspace(state.workspaces, workspace),
      commandLists: {
        ...state.commandLists,
        [workspaceId]: commands
      }
    }))
  },
  async setCommandChain(workspaceId, commandId, prerequisiteIds) {
    try {
      const workspace = await window.workspaceApi.workspaces.setCommandChain({ workspaceId, commandId, prerequisiteIds })
      if (!workspace) return
      const [commands, docker] = await Promise.all([
        window.workspaceApi.commands.list(workspaceId),
        window.workspaceApi.docker.list(workspaceId)
      ])
      set((state) => ({
        workspaces: replaceWorkspace(state.workspaces, workspace),
        commandLists: {
          ...state.commandLists,
          [workspaceId]: commands
        },
        dockerLists: {
          ...state.dockerLists,
          [workspaceId]: docker
        },
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to update command steps.'
      })
    }
  },
  async saveRunConfiguration(workspaceId, actions, defaultActionId) {
    try {
      const workspace = await window.workspaceApi.workspaces.setRunConfiguration({
        workspaceId,
        actions,
        defaultActionId
      })
      if (!workspace) return
      set((state) => ({
        workspaces: replaceWorkspace(state.workspaces, workspace),
        lastActionError: null
      }))
    } catch (error) {
      set({
        lastActionError: error instanceof Error ? error.message : 'Failed to save run configurations.'
      })
    }
  },
  async savePinnedEndpoints(workspaceId, endpoints) {
    const nextWorkspace = await window.workspaceApi.workspaces.setPinnedEndpoints({ workspaceId, endpoints })
    if (!nextWorkspace) return
    set((state) => ({
      workspaces: replaceWorkspace(state.workspaces, nextWorkspace)
    }))
  },
  async togglePinnedEndpoint(workspaceId, endpoint) {
    const workspace = get().workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return
    const pinnedEndpoints = workspace.pinnedEndpoints ?? []
    const nextEndpoints = pinnedEndpoints.some((item) => item.url === endpoint.url)
      ? pinnedEndpoints.filter((item) => item.url !== endpoint.url)
      : [...pinnedEndpoints, endpoint]
    await get().savePinnedEndpoints(workspaceId, nextEndpoints)
  },
  async saveLink(workspaceId, link) {
    const links = await window.workspaceApi.links.upsert({ workspaceId, link })
    set((state) => ({
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, quickLinks: links } : workspace
      )
    }))
  },
  async deleteLink(workspaceId, linkId) {
    const links = await window.workspaceApi.links.delete(workspaceId, linkId)
    set((state) => ({
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, quickLinks: links } : workspace
      )
    }))
  },
  handleTerminalOutput(event) {
    if (containsDomRendererLeak(event.chunk)) return
    queueTerminalOutput(event)
  },
  handleTerminalExit(event) {
    set((state) => ({
      terminals: state.terminals.map((session) =>
        session.id === event.sessionId
          ? {
              ...session,
              exitCode: event.exitCode,
              status: session.status === 'stopped' ? 'stopped' : event.exitCode === 0 ? 'exited' : 'failed',
              updatedAt: Date.now()
            }
          : session
      )
    }))
  }
  }
})

function uniqueWorkspaces(existing: WorkspaceRecord[], incoming: WorkspaceRecord[]) {
  const map = new Map(existing.map((workspace) => [workspace.id, normalizeWorkspaceRecord(workspace)]))
  for (const workspace of incoming) {
    map.set(workspace.id, normalizeWorkspaceRecord(workspace))
  }
  return Array.from(map.values())
}

// Navigation changes are infrequent; terminal output never writes ui state.
useAppStore.subscribe((state, previous) => {
  if (!state.bootstrapped) return
  const visible = visibleTerminals(state)
  if (!visible.some((session) => session.id === state.activeTerminalId) && state.activeTerminalId !== (visible[0]?.id ?? null)) {
    useAppStore.setState({ activeTerminalId: visible[0]?.id ?? null })
  }
  const ui = navigationState(state)
  const before = navigationState(previous)
  if (Object.keys(ui).every((key) => ui[key as keyof UiState] === before[key as keyof UiState])) return
  if (typeof window === 'undefined' || !window.workspaceApi?.ui) return
  void window.workspaceApi.ui.set(ui).catch((error) => {
    useAppStore.setState({ lastActionError: `Could not save navigation: ${error instanceof Error ? error.message : String(error)}` })
  })
})

export function useSelectedWorkspace(): WorkspaceRecord | null {
  const { workspaces, selectedWorkspaceId } = useAppStore()
  return workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
}

/** Sidebar order, filtered by the search box (names, paths and detected projects). */
export function filterVisibleWorkspaces(groups: GroupRecord[], workspaces: WorkspaceRecord[], search: string) {
  const query = search.trim().toLowerCase()
  return sortWorkspacesForSidebar(groups, workspaces).filter((workspace) => {
    if (!query) return true
    return (
      workspace.name.toLowerCase().includes(query) ||
      workspace.rootPath.toLowerCase().includes(query) ||
      workspace.projects.some((project) =>
        project.name.toLowerCase().includes(query) || project.relativePath.toLowerCase().includes(query))
    )
  })
}

export function useVisibleWorkspaces() {
  const groups = useAppStore((state) => state.groups)
  const workspaces = useAppStore((state) => state.workspaces)
  const search = useAppStore((state) => state.search)
  return useMemo(() => filterVisibleWorkspaces(groups, workspaces, search), [groups, workspaces, search])
}

export function useWorkspaceLinks(workspaceId: string | null): QuickLink[] {
  const workspaces = useAppStore((state) => state.workspaces)
  return workspaces.find((workspace) => workspace.id === workspaceId)?.quickLinks ?? []
}
