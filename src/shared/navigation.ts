import type { GroupRecord, TerminalSession, UiState, WorkspaceRecord } from './types'
import { listWorkspaceWorktrees, normalizeComparePath, resolveSelectedWorktreePath } from './worktreeExecution'
import { sortWorkspacesForSidebar } from './workspaceGroups'

export const UNGROUPED_KEY = '__ungrouped__'

export function defaultUiState(): UiState {
  return {
    selectedGroupId: 'all', selectedWorkspaceId: null, selectedWorktreeByWorkspace: {},
    sidebarCollapsed: true, collapsedGroupIds: [], consoleTabFilter: 'all'
  }
}

/** Restore only live references; stale/deleted selections silently fall back. */
export function normalizeUiState(
  input: Partial<UiState> | undefined, groups: GroupRecord[], workspaces: WorkspaceRecord[],
  exists: (path: string) => boolean = () => true
): UiState {
  const ui = { ...defaultUiState(), ...input }
  const workspace = workspaces.find((entry) => entry.id === ui.selectedWorkspaceId)
    ?? sortWorkspacesForSidebar(groups, workspaces)[0]
  const selectedWorktreeByWorkspace: Record<string, string> = {}
  for (const entry of workspaces) {
    const available = listWorkspaceWorktrees(entry).filter((tree) => !tree.isMissing && exists(tree.path))
    const saved = ui.selectedWorktreeByWorkspace?.[entry.id]
    const match = typeof saved === 'string' ? available.find((tree) => normalizeComparePath(tree.path) === normalizeComparePath(saved)) : null
    selectedWorktreeByWorkspace[entry.id] = match?.path
      ?? available.find((tree) => tree.isMain)?.path ?? available[0]?.path ?? entry.rootPath
  }
  const groupIds = new Set(groups.map((group) => group.id))
  return {
    selectedWorkspaceId: workspace?.id ?? null,
    selectedGroupId: ui.selectedGroupId === 'all' || groupIds.has(ui.selectedGroupId)
      ? ui.selectedGroupId : workspace?.groupId ?? 'all',
    selectedWorktreeByWorkspace,
    sidebarCollapsed: typeof ui.sidebarCollapsed === 'boolean' ? ui.sidebarCollapsed : true,
    collapsedGroupIds: [...new Set((Array.isArray(ui.collapsedGroupIds) ? ui.collapsedGroupIds : []).filter((id) => id === UNGROUPED_KEY || groupIds.has(id)))],
    consoleTabFilter: ui.consoleTabFilter === 'worktree' ? 'worktree' : 'all'
  }
}

export function visibleConsoleSessions(
  terminals: TerminalSession[], workspace: WorkspaceRecord | null | undefined,
  filter: UiState['consoleTabFilter'], selectedWorktreePath?: string
) {
  if (!workspace) return []
  const checkout = resolveSelectedWorktreePath(workspace, selectedWorktreePath)
  return terminals.filter((session) => session.workspaceId === workspace.id && (
    filter === 'all' || normalizeComparePath(session.worktreePath ?? workspace.rootPath) === normalizeComparePath(checkout)
  ))
}
