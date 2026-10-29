import { legacyWorkspaceView, workspaceFromLegacy } from '@shared/workspaceModel'
import type { WorkspaceRecord } from '@shared/types'
import type { AppStore } from '@main/store'
import { buildWorkspaceRecord } from './workspaceDiscovery'
import { discoverProjects } from './projectDiscovery'

type WorkspaceScanStore = Pick<AppStore, 'getWorkspaceRecords' | 'getWorkspaceRecord' | 'upsertWorkspaceRecord'>

export async function scanWorkspace(rootPath: string, groupId: string | null, previous: WorkspaceRecord | null = null): Promise<WorkspaceRecord> {
  const legacy = await buildWorkspaceRecord(rootPath, groupId ? [groupId] : [], previous ? legacyWorkspaceView(previous, process.platform === 'win32') : null)
  const projects = await discoverProjects(rootPath, { gitWorktrees: legacy.gitWorktrees, gitWorktreesRoot: previous?.gitWorktreesRoot })
  return {
    ...workspaceFromLegacy(legacy, groupId), projects,
    openTarget: previous?.openTarget ?? null,
    gitWorktreesRoot: previous?.gitWorktreesRoot ?? null
  }
}

export async function refreshWorkspace(store: WorkspaceScanStore, workspaceId: string) {
  const previous = store.getWorkspaceRecord(workspaceId)
  if (!previous) return null
  const scanned = await scanWorkspace(previous.rootPath, previous.groupId, previous)
  const latest = store.getWorkspaceRecord(workspaceId)
  if (!latest) return null
  // User edits can arrive while discovery is running. Only scan metadata is replaced.
  return store.upsertWorkspaceRecord({
    ...latest, projects: scanned.projects, gitSummary: scanned.gitSummary,
    gitWorktrees: scanned.gitWorktrees, lastScanAt: scanned.lastScanAt,
    name: latest.nameOverride ?? scanned.name
  })
}

export async function rescanWorkspaceQueue(
  store: WorkspaceScanStore,
  onWorkspace: (workspace: WorkspaceRecord) => void,
  onError: (workspaceId: string, error: unknown) => void
) {
  const ids = store.getWorkspaceRecords().map((workspace) => workspace.id)
  await new Promise<void>((resolve) => setImmediate(resolve))
  for (const id of ids) {
    try {
      const workspace = await refreshWorkspace(store, id)
      if (workspace) onWorkspace(workspace)
    } catch (error) {
      onError(id, error)
    }
  }
}
