import { createAppCliHandler } from '@main/services/appCliActions'
import { app, clipboard, dialog, ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  WORKSPACE_GET_DETAILS_CONVERT_WORKTREES_PREFIX,
  parseWorkspaceGetDetailsCleanupWorktreesKey,
  parseWorkspaceGetDetailsCreateWorktreeKey,
  parseWorkspaceGetDetailsRemoveWorktreeKey
} from '@shared/gitWorktreeBridge'
import { normalizeComparePath } from '@shared/worktreeExecution'
import { resolveRunWorktreePath } from '@main/services/runWorktree'
import { runActionCommandId } from '@shared/runActions'
import type {
  AppSettings,
  OpenTarget,
  AddWorkspacesInput,
  CleanupGitWorktreesInput,
  CleanupGitWorktreesResult,
  ConvertRepoToWorktreesResult,
  GroupCreateInput,
  GroupUpdateInput,
  CreateGitWorktreeInput,
  CreateGitWorktreeResult,
  ImportCandidatesInput,
  LinkUpsertInput,
  WorkspaceCandidate,
  WorkspaceRecord,
  MoveWorkspaceInput,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
  RenameWorkspaceInput,
  ReorderGroupsInput,
  SetCommandChainInput,
  SetPinnedEndpointsInput,
  SetRunConfigurationInput,
  TerminalRenameInput,
  TerminalSession,
  UiState,
  ToggleFavoriteInput
} from '@shared/types'
import { AppStore } from '@main/store'
import { listWorkspaceCommands, resolveRunPlan, validateWorkspaceCommandChain } from '@main/services/workspaceCommands'
import {
  cleanupGitWorktrees,
  convertRepoToWorktrees as setupGitWorktrees,
  createGitWorktree,
  defaultGitWorktreesRoot,
  getGitSummary,
  removeGitWorktree
} from '@main/services/git'
import { findCandidatesFromPaths, findCandidatesInParent } from '@main/services/workspaceDiscovery'
import { moveWorkspaceToGroup, nextOrderInGroup, normalizeGroupColor, reorderGroups, sortByOrder, ungroupWorkspaces } from '@shared/workspaceGroups'
import { scanWorkspace, rescanWorkspaceQueue, refreshWorkspace } from '@main/services/workspaceScan'
import { TerminalManager } from '@main/services/terminalManager'
import { openExternal, openInEditor, openInTerminal, openPath, openWorkspaceTarget } from '@main/services/systemActions'

function uniqueById<T extends { id: string }>(values: T[]) {
  return Array.from(new Map(values.map((value) => [value.id, value])).values())
}

async function scanAndStoreWorkspace(store: AppStore, rootPath: string, groupId: string | null, previous?: WorkspaceRecord | null) {
  const workspace = await scanWorkspace(rootPath, groupId, previous ?? null)
  return store.upsertWorkspaceRecord(workspace)
}

function updateWorkspace(store: AppStore, workspaceId: string, update: (workspace: WorkspaceRecord) => WorkspaceRecord) {
  const workspace = store.getWorkspaceRecord(workspaceId)
  return workspace ? store.upsertWorkspaceRecord(update(workspace)) : null
}

async function convertRepoToWorktreesWorkspace(store: AppStore, workspaceId: string): Promise<ConvertRepoToWorktreesResult> {
  const existing = store.getWorkspaceRecord(workspaceId)
  if (!existing) throw new Error('Workspace not found.')

  const worktreesRoot = await setupGitWorktrees(existing.rootPath, defaultGitWorktreesRoot(existing.rootPath))
  const workspace = await scanAndStoreWorkspace(store, existing.rootPath, existing.groupId, {
    ...existing,
    gitWorktreesRoot: worktreesRoot
  })
  return { workspace, worktreesRoot }
}

async function createGitWorktreeWorkspace(store: AppStore, input: CreateGitWorktreeInput): Promise<CreateGitWorktreeResult> {
  const existing = store.getWorkspaceRecord(input.workspaceId)
  if (!existing) throw new Error('Workspace not found.')
  if (!existing.gitWorktreesRoot) {
    throw new Error('Set up worktrees for this repository before adding a branch checkout.')
  }

  const worktreesRoot = defaultGitWorktreesRoot(existing.rootPath)
  const worktreePath = await createGitWorktree(existing.rootPath, {
    worktreesRoot,
    branch: input.branch,
    createBranch: input.createBranch ?? false
  })
  const workspace = await scanAndStoreWorkspace(store, existing.rootPath, existing.groupId, existing)
  return { workspace, worktreePath }
}

function sessionUsesRemovedWorktree(session: TerminalSession, removed: Set<string>) {
  const paths = [session.worktreePath, session.cwd].filter((value): value is string => Boolean(value))
  return paths.some((path) => removed.has(normalizeComparePath(path)))
}

async function forgetRemovedWorktrees(
  store: AppStore,
  terminalManager: TerminalManager,
  keepWorkspaceId: string,
  removedPaths: string[]
) {
  const removed = new Set(removedPaths.map((path) => normalizeComparePath(path)))
  if (removed.size === 0) return

  for (const session of terminalManager.list()) {
    const workspace = store.getWorkspaceRecord(session.workspaceId)
    const workspaceRootRemoved = workspace ? removed.has(normalizeComparePath(workspace.rootPath)) : false
    if (sessionUsesRemovedWorktree(session, removed) || (session.workspaceId !== keepWorkspaceId && workspaceRootRemoved)) {
      await terminalManager.remove(session.id)
    }
  }

  for (const workspace of store.getWorkspaceRecords()) {
    if (workspace.id === keepWorkspaceId) continue
    if (!removed.has(normalizeComparePath(workspace.rootPath))) continue
    const leftover = terminalManager.list().filter((session) => session.workspaceId === workspace.id)
    await Promise.all(leftover.map((session) => terminalManager.remove(session.id)))
    store.removeWorkspace(workspace.id)
  }
}

async function cleanupGitWorktreesWorkspace(
  store: AppStore,
  terminalManager: TerminalManager,
  input: CleanupGitWorktreesInput
): Promise<CleanupGitWorktreesResult> {
  const existing = store.getWorkspaceRecord(input.workspaceId)
  if (!existing) throw new Error('Workspace not found.')

  const result = await cleanupGitWorktrees(existing.rootPath, {
    maxAgeDays: input.maxAgeDays,
    includeDirty: input.includeDirty,
    protectPaths: [existing.rootPath, ...(input.protectPaths ?? [])],
    worktreePaths: input.worktreePaths
  })
  await forgetRemovedWorktrees(store, terminalManager, existing.id, result.removedPaths)
  const workspace = await scanAndStoreWorkspace(store, existing.rootPath, existing.groupId, existing)
  return { workspace, removedPaths: result.removedPaths, skipped: result.skipped, errors: result.errors }
}

async function removeGitWorktreeWorkspace(
  store: AppStore,
  terminalManager: TerminalManager,
  input: RemoveGitWorktreeInput
): Promise<RemoveGitWorktreeResult> {
  const existing = store.getWorkspaceRecord(input.workspaceId)
  if (!existing) throw new Error('Workspace not found.')

  const worktreePath = await removeGitWorktree(existing.rootPath, input.worktreePath, {
    protectPaths: [existing.rootPath]
  })
  await forgetRemovedWorktrees(store, terminalManager, existing.id, [worktreePath])
  const workspace = await scanAndStoreWorkspace(store, existing.rootPath, existing.groupId, existing)
  return { workspace, worktreePath }
}

async function resolveImportCandidates(input: ImportCandidatesInput): Promise<WorkspaceCandidate[]> {
  if (input.mode === 'paths') {
    return findCandidatesFromPaths(input.paths ?? [])
  }

  if (input.mode === 'folders') {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled) return []
    return findCandidatesFromPaths(result.filePaths)
  }

  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return []
  return findCandidatesInParent(result.filePaths[0])
}

export function registerIpc(mainWindow: BrowserWindow, store: AppStore, ensureWindow: () => BrowserWindow = () => mainWindow) {
  const terminalManager = new TerminalManager({
    initialSessions: store.getTerminals(),
    preferredShell: store.getPreferredShell(),
    getShellSettings: () => store.getSettings(),
    onSessionChange: (sessions) => store.setTerminals(sessions),
    resolveSessionRun: async (session) => {
      const workspace = store.getWorkspaceRecord(session.workspaceId)
      if (session.commandId.includes('::custom::')) return null
      if (!workspace) throw new Error('Workspace no longer exists.')
      return resolveRunPlan(workspace, session.commandId, session.worktreePath)
    }
  })

  terminalManager.on('output', (event) => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('terminals:output', event)
  })
  terminalManager.on('exit', (event) => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('terminals:exit', event)
  })

  let isShuttingDown = false
  const shutdownTerminals = () => {
    if (isShuttingDown) return
    isShuttingDown = true
    terminalManager.shutdown()
    store.flushPendingWrites()
  }

  // Keep this cleanup synchronous: Node cannot wait for asynchronous work while
  // handling process exit or an uncaught exception.
  app.once('before-quit', shutdownTerminals)
  if (process.platform !== 'darwin') mainWindow.once('closed', shutdownTerminals)
  process.once('exit', shutdownTerminals)
  process.once('uncaughtExceptionMonitor', shutdownTerminals)

  const exitForSignal = (exitCode: number) => () => {
    shutdownTerminals()
    process.exit(exitCode)
  }
  process.once('SIGINT', exitForSignal(130))
  process.once('SIGTERM', exitForSignal(143))
  process.once('SIGHUP', exitForSignal(129))

  ipcMain.handle('settings.get', async () => store.getSettings())
  ipcMain.handle('settings.update', async (_event, patch: Partial<AppSettings>) => store.updateSettings(patch))
  ipcMain.handle('settings.platform', async () => process.platform)
  ipcMain.handle('settings.pickNodeCaCertificate', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose a Node CA certificate', properties: ['openFile'], filters: [{ name: 'Certificates', extensions: ['pem', 'crt', 'cer'] }, { name: 'All files', extensions: ['*'] }] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('workspaces.setOpenTarget', async (_event, workspaceId: string, openTarget: OpenTarget | null) => {
    if (openTarget !== null && !['cursor', 'vscode', 'folder', 'terminal'].includes(openTarget)) throw new Error('Invalid Open target.')
    return updateWorkspace(store, workspaceId, (workspace) => ({ ...workspace, openTarget }))
  })
  ipcMain.handle('system.openWorkspace', async (_event, workspaceId: string, worktreePath: string) => {
    const workspace = store.getWorkspaceRecord(workspaceId)
    if (!workspace) throw new Error('Workspace not found.')
    const settings = store.getSettings()
    return openWorkspaceTarget(resolveRunWorktreePath(workspace, worktreePath), workspace.openTarget ?? settings.defaultOpenTarget, settings.preferredExternalTerminal)
  })
  ipcMain.handle('system.migrationNotes', async () => store.getMigrationNotes())
  ipcMain.handle('system.clearMigrationNotes', async () => store.clearMigrationNotes())

  ipcMain.handle('ui.get', async () => store.getUiState())
  ipcMain.handle('ui.set', async (_event, ui: UiState) => { store.setUiState(ui) })
  ipcMain.handle('groups.list', async () => sortByOrder(store.getGroups()))
  ipcMain.handle('groups.create', async (_event, input: GroupCreateInput) => {
    const name = input.name.trim()
    if (!name) throw new Error('Group name cannot be empty.')
    const groups = store.getGroups()
    const next = { id: `group-${randomUUID()}`, name, order: groups.length, color: normalizeGroupColor(input.color) }
    store.setGroups([...groups, next])
    return next
  })
  ipcMain.handle('groups.update', async (_event, input: GroupUpdateInput) => {
    const current = store.getGroups().find((group) => group.id === input.id)
    if (!current) return null
    const name = input.name === undefined ? current.name : input.name.trim()
    if (!name) throw new Error('Group name cannot be empty.')
    const color = input.color === undefined ? current.color : normalizeGroupColor(input.color)
    const next = { ...current, name, color }
    store.setGroups(store.getGroups().map((group) => (group.id === input.id ? next : group)))
    return next
  })
  ipcMain.handle('groups.delete', async (_event, id: string) => {
    store.setGroups(reorderGroups(store.getGroups().filter((group) => group.id !== id), []))
    const workspaces = ungroupWorkspaces(store.getWorkspaceRecords(), id)
    store.setWorkspaceRecords(workspaces)
    return workspaces
  })
  ipcMain.handle('groups.reorder', async (_event, input: ReorderGroupsInput) => {
    const groups = reorderGroups(store.getGroups(), input.ids)
    store.setGroups(groups)
    return groups
  })

  ipcMain.handle('workspaces.list', async () => store.getWorkspaceRecords())
  ipcMain.handle('workspaces.importCandidates', async (_event, input: ImportCandidatesInput) => resolveImportCandidates(input))
  ipcMain.handle('workspaces.add', async (_event, input: AddWorkspacesInput) => {
    const groupId = input.groupId && store.getGroups().some((group) => group.id === input.groupId) ? input.groupId : null
    const added: WorkspaceRecord[] = []
    for (const candidate of input.candidates) {
      const existing = store.getWorkspaceRecords().find((workspace) => workspace.rootPath === candidate.rootPath) ?? null
      // Re-adding a known folder rescans it but keeps its group and position.
      const targetGroupId = existing ? existing.groupId : groupId
      const scanned = await scanWorkspace(candidate.rootPath, targetGroupId, existing)
      const order = existing ? existing.order : nextOrderInGroup(store.getWorkspaceRecords(), targetGroupId)
      added.push(store.upsertWorkspaceRecord({ ...scanned, order }))
    }
    return added
  })
  ipcMain.handle('workspaces.move', async (_event, input: MoveWorkspaceInput) => {
    if (input.groupId && !store.getGroups().some((group) => group.id === input.groupId)) {
      throw new Error(`Unknown group: ${input.groupId}`)
    }
    const workspaces = moveWorkspaceToGroup(store.getWorkspaceRecords(), input)
    store.setWorkspaceRecords(workspaces)
    return store.getWorkspaceRecords()
  })
  ipcMain.handle('workspaces.rename', async (_event, input: RenameWorkspaceInput) => {
    const trimmed = input.name.trim()
    if (!trimmed) throw new Error('Workspace name cannot be empty.')
    return updateWorkspace(store, input.workspaceId, (workspace) => ({ ...workspace, name: trimmed, nameOverride: trimmed }))
  })
  ipcMain.handle('workspaces.remove', async (_event, workspaceId: string) => {
    const workspaceSessions = terminalManager.list().filter((session) => session.workspaceId === workspaceId)
    await Promise.all(workspaceSessions.map((session) => terminalManager.remove(session.id)))
    store.removeWorkspace(workspaceId)
  })
  ipcMain.handle('workspaces.rescan', async (_event, workspaceId: string) => refreshWorkspace(store, workspaceId))
  ipcMain.handle('workspaces.getDetails', async (_event, workspaceId: string) => {
    if (workspaceId.startsWith(WORKSPACE_GET_DETAILS_CONVERT_WORKTREES_PREFIX)) {
      const realId = workspaceId.slice(WORKSPACE_GET_DETAILS_CONVERT_WORKTREES_PREFIX.length)
      const { workspace } = await convertRepoToWorktreesWorkspace(store, realId)
      return workspace
    }

    const createInput = parseWorkspaceGetDetailsCreateWorktreeKey(workspaceId)
    if (createInput) {
      const { workspace } = await createGitWorktreeWorkspace(store, createInput)
      return workspace
    }

    const cleanupInput = parseWorkspaceGetDetailsCleanupWorktreesKey(workspaceId)
    if (cleanupInput) {
      const { workspace } = await cleanupGitWorktreesWorkspace(store, terminalManager, cleanupInput)
      return workspace
    }

    const removeInput = parseWorkspaceGetDetailsRemoveWorktreeKey(workspaceId)
    if (removeInput) {
      const { workspace } = await removeGitWorktreeWorkspace(store, terminalManager, removeInput)
      return workspace
    }

    return store.getWorkspaceRecord(workspaceId)
  })
  ipcMain.handle('workspaces.toggleFavoriteCommand', async (_event, input: ToggleFavoriteInput) =>
    updateWorkspace(store, input.workspaceId, (workspace) => ({
      ...workspace,
      favoriteCommandIds: workspace.favoriteCommandIds.includes(input.commandId)
        ? workspace.favoriteCommandIds.filter((id) => id !== input.commandId)
        : [...workspace.favoriteCommandIds, input.commandId]
    })))
  ipcMain.handle('workspaces.setCommandChain', async (_event, input: SetCommandChainInput) =>
    updateWorkspace(store, input.workspaceId, (workspace) => {
      const prerequisiteIds = validateWorkspaceCommandChain(workspace, input.commandId, input.prerequisiteIds)
      const commandChains = { ...workspace.commandChains }
      if (prerequisiteIds.length === 0) delete commandChains[input.commandId]
      else commandChains[input.commandId] = prerequisiteIds
      return { ...workspace, commandChains }
    }))
  ipcMain.handle('workspaces.setRunConfiguration', async (_event, input: SetRunConfigurationInput) => {
    const runActions = uniqueById(input.actions
      .map((action) => ({
        id: action.id.trim() || randomUUID(),
        command: action.command.trim(),
        description: action.description.trim()
      }))
      .filter((action) => action.command && action.description))
    const defaultRunActionId = input.defaultActionId && runActions.some((action) => action.id === input.defaultActionId)
      ? input.defaultActionId
      : runActions[0]?.id ?? null
    return updateWorkspace(store, input.workspaceId, (workspace) => ({ ...workspace, runActions, defaultRunActionId }))
  })
  ipcMain.handle('workspaces.setPinnedEndpoints', async (_event, input: SetPinnedEndpointsInput) => {
    const endpoints = input.endpoints
      .map((endpoint) => ({ url: endpoint.url.trim(), label: endpoint.label.trim() }))
      .filter((endpoint) => {
        try {
          const protocol = new URL(endpoint.url).protocol
          return protocol === 'http:' || protocol === 'https:'
        } catch {
          return false
        }
      })
    const pinnedEndpoints = Array.from(new Map(endpoints.map((endpoint) => [endpoint.url, endpoint])).values())
    return updateWorkspace(store, input.workspaceId, (workspace) => ({ ...workspace, pinnedEndpoints }))
  })

  ipcMain.handle('commands.list', async (_event, workspaceId: string) => {
    const workspace = store.getWorkspaceRecord(workspaceId)
    return workspace ? listWorkspaceCommands(workspace) : { favorites: [], groups: [] }
  })
  const runStoredCommand = async (input: { commandId: string; worktreePath?: string | null }) => {
    const workspace = store.getWorkspaceRecords().find((workspace) =>
      listWorkspaceCommands(workspace).groups.some((group) => group.commands.some((command) => command.id === input.commandId)))
    if (!workspace) throw new Error(`Unknown command: ${input.commandId}`)
    const worktreePath = resolveRunWorktreePath(workspace, input.worktreePath)
    const plan = resolveRunPlan(workspace, input.commandId, worktreePath)
    if (!plan) throw new Error(`Unable to resolve command: ${input.commandId}`)
    const command = listWorkspaceCommands(workspace).groups.flatMap((group) => group.commands).find((command) => command.id === input.commandId)!
    return terminalManager.run({
      workspaceId: workspace.id, projectId: command.projectId ?? null,
      commandId: plan.commandId, title: plan.title, worktreePath, shellLine: plan.shellLine, runPlan: plan
    })
  }
  ipcMain.handle('commands.run', async (_event, input: { commandId: string; worktreePath?: string | null }) => runStoredCommand(input))
  ipcMain.handle('docker.run', async (_event, input: { commandId: string; worktreePath?: string | null }) => runStoredCommand(input))
  ipcMain.handle('commands.runCustom', async (_event, input: { workspaceId: string; actionId: string; worktreePath?: string | null }) =>
    runStoredCommand({ commandId: runActionCommandId(input.workspaceId, input.actionId), worktreePath: input.worktreePath }))
  ipcMain.handle('docker.list', async (_event, workspaceId: string) => {
    const workspace = store.getWorkspaceRecord(workspaceId)
    return { groups: workspace ? listWorkspaceCommands(workspace).groups.map((group) => ({
      ...group, commands: group.commands.filter((command) => command.kind === 'docker').map((command) => ({ ...command, shellLine: command.script }))
    })).filter((group) => group.commands.length) : [] }
  })

  ipcMain.handle('terminals.list', async () => terminalManager.list())
  ipcMain.handle('terminals.restore', async () => terminalManager.restore())
  ipcMain.handle('terminals.write', async (_event, sessionId: string, data: string) => {
    await terminalManager.write(sessionId, data)
  })
  ipcMain.handle('terminals.resize', async (_event, sessionId: string, cols: number, rows: number) => {
    terminalManager.resize(sessionId, cols, rows)
  })
  ipcMain.handle('terminals.stop', async (_event, sessionId: string) => terminalManager.stop(sessionId))
  ipcMain.handle('terminals.stopAll', async () => terminalManager.stopAll())
  ipcMain.handle('terminals.pauseWorkspace', async (_event, workspaceId: string) => terminalManager.pauseWorkspace(workspaceId))
  ipcMain.handle('terminals.resumeWorkspace', async (_event, workspaceId: string) => terminalManager.resumeWorkspace(workspaceId))
  const groupWorkspaceIds = (groupId: string) => {
    if (!store.getGroups().some((group) => group.id === groupId)) throw new Error('Group not found.')
    return store.getWorkspaceRecords().filter((workspace) => workspace.groupId === groupId).map((workspace) => workspace.id)
  }
  ipcMain.handle('terminals.pauseGroup', async (_event, groupId: string) => terminalManager.pauseGroup(groupWorkspaceIds(groupId)))
  ipcMain.handle('terminals.resumeGroup', async (_event, groupId: string) => terminalManager.resumeGroup(groupWorkspaceIds(groupId)))
  ipcMain.handle('terminals.killGroup', async (_event, groupId: string) => terminalManager.killGroup(groupWorkspaceIds(groupId)))
  ipcMain.handle('terminals.restart', async (_event, sessionId: string) => terminalManager.restart(sessionId))
  ipcMain.handle('terminals.clear', async (_event, sessionId: string) => terminalManager.clear(sessionId))
  ipcMain.handle('terminals.remove', async (_event, sessionId: string) => {
    await terminalManager.remove(sessionId)
  })
  ipcMain.handle('terminals.rename', async (_event, input: TerminalRenameInput) =>
    terminalManager.rename(input.sessionId, input.title)
  )
  ipcMain.handle('terminals.togglePin', async (_event, sessionId: string) => terminalManager.togglePin(sessionId))

  ipcMain.handle('git.getSummary', async (_event, workspaceId: string) => {
    const workspace = store.getWorkspaceRecord(workspaceId)
    if (!workspace) return null
    const summary = await getGitSummary(workspace.rootPath)
    if (!summary) return null
    updateWorkspace(store, workspaceId, (latest) => ({ ...latest, gitSummary: summary }))
    return summary
  })
  ipcMain.handle('git.convertRepoToWorktrees', async (_event, workspaceId: string) =>
    convertRepoToWorktreesWorkspace(store, workspaceId)
  )
  ipcMain.handle('git.createWorktree', async (_event, input: CreateGitWorktreeInput) =>
    createGitWorktreeWorkspace(store, input)
  )
  ipcMain.handle('git.cleanupWorktrees', async (_event, input: CleanupGitWorktreesInput) =>
    cleanupGitWorktreesWorkspace(store, terminalManager, input)
  )
  ipcMain.handle('git.removeWorktree', async (_event, input: RemoveGitWorktreeInput) =>
    removeGitWorktreeWorkspace(store, terminalManager, input)
  )

  ipcMain.handle('links.list', async (_event, workspaceId: string) => store.getWorkspaceRecord(workspaceId)?.quickLinks ?? [])
  ipcMain.handle('links.upsert', async (_event, input: LinkUpsertInput) => {
    const nextLink = {
      id: input.link.id ?? `link-${Date.now().toString(36)}`,
      label: input.link.label.trim(),
      url: input.link.url.trim()
    }
    return updateWorkspace(store, input.workspaceId, (workspace) => ({
      ...workspace, quickLinks: uniqueById([...workspace.quickLinks, nextLink])
    }))?.quickLinks ?? []
  })
  ipcMain.handle('links.delete', async (_event, workspaceId: string, linkId: string) =>
    updateWorkspace(store, workspaceId, (workspace) => ({
      ...workspace, quickLinks: workspace.quickLinks.filter((link) => link.id !== linkId)
    }))?.quickLinks ?? [])

  ipcMain.handle('system.openInEditor', async (_event, targetPath: string, editor: 'cursor' | 'vscode' | undefined) =>
    openInEditor(targetPath, editor)
  )
  ipcMain.handle('system.openInTerminal', async (_event, targetPath: string) => openInTerminal(targetPath, store.getSettings().preferredExternalTerminal))
  ipcMain.handle('system.openPath', async (_event, targetPath: string) => openPath(targetPath))
  ipcMain.handle('system.openExternal', async (_event, url: string) => openExternal(url))
  ipcMain.handle('system.copyText', async (_event, value: string) => {
    clipboard.writeText(value)
  })

  let startupScanStarted = false
  ipcMain.handle('workspaces.startupRescan', () => {
    if (startupScanStarted) return
    startupScanStarted = true
    const send = (channel: string, payload: unknown) => {
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, payload)
    }
    void rescanWorkspaceQueue(store,
      (workspace) => send('workspaces:updated', workspace),
      (id, error) => send('workspaces:scan-error', `Could not rescan ${id}: ${error instanceof Error ? error.message : String(error)}`)
    )
  })
  return {
    terminalManager,
    setWindow(window: BrowserWindow) { mainWindow = window },
    handleCli: createAppCliHandler({ store, terminals: terminalManager, runStoredCommand,
      changed: (sessionId) => {
        if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('app:changed', { sessionId })
      },
      focus: () => { mainWindow = ensureWindow(); if (!mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() } }
    })
  }
}
