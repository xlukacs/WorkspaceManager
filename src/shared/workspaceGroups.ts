import type { GroupRecord, WorkspaceRecord } from './types'

/** Sidebar order: by `order` within a group, then by name. */
export function sortByOrder<T extends { order: number; name: string }>(items: T[]) {
  return [...items].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
}

export function workspacesInGroup<T extends Pick<WorkspaceRecord, 'groupId' | 'order' | 'name'>>(workspaces: T[], groupId: string | null) {
  return sortByOrder(workspaces.filter((workspace) => (workspace.groupId ?? null) === groupId))
}

function renumber<T extends { order: number }>(items: T[]) {
  return items.map((item, index) => (item.order === index ? item : { ...item, order: index }))
}

/** Groups in order, each with its workspaces; ungrouped workspaces form a final section. */
export function groupWorkspaces<W extends Pick<WorkspaceRecord, 'groupId' | 'order' | 'name'>>(groups: GroupRecord[], workspaces: W[]) {
  const known = new Set(groups.map((group) => group.id))
  return {
    groups: sortByOrder(groups).map((group) => ({ group, workspaces: workspacesInGroup(workspaces, group.id) })),
    // A workspace whose group no longer exists is shown as ungrouped rather than hidden.
    ungrouped: sortByOrder(workspaces.filter((workspace) => !workspace.groupId || !known.has(workspace.groupId)))
  }
}

/** The sidebar's top-to-bottom order: grouped workspaces by group order, then ungrouped ones. */
export function sortWorkspacesForSidebar<W extends Pick<WorkspaceRecord, 'groupId' | 'order' | 'name'>>(groups: GroupRecord[], workspaces: W[]) {
  const tree = groupWorkspaces(groups, workspaces)
  return [...tree.groups.flatMap((entry) => entry.workspaces), ...tree.ungrouped]
}

/**
 * Move a workspace into `groupId` (null = ungrouped) at `index` within that group, then renumber
 * the source and target groups so `order` stays contiguous. Other workspaces are untouched.
 */
export function moveWorkspaceToGroup<T extends Pick<WorkspaceRecord, 'id' | 'groupId' | 'order' | 'name'>>(
  workspaces: T[],
  input: { workspaceId: string; groupId: string | null; index: number }
): T[] {
  const moving = workspaces.find((workspace) => workspace.id === input.workspaceId)
  if (!moving) return workspaces
  const sourceGroupId = moving.groupId ?? null
  const target = workspacesInGroup(workspaces, input.groupId).filter((workspace) => workspace.id !== moving.id)
  const index = Math.max(0, Math.min(Math.trunc(input.index), target.length))
  target.splice(index, 0, { ...moving, groupId: input.groupId })
  const updates = new Map(renumber(target).map((workspace) => [workspace.id, workspace]))
  if (sourceGroupId !== input.groupId) {
    for (const workspace of renumber(workspacesInGroup(workspaces, sourceGroupId).filter((entry) => entry.id !== moving.id))) {
      updates.set(workspace.id, workspace)
    }
  }
  return workspaces.map((workspace) => updates.get(workspace.id) ?? workspace)
}

/** Deleting a group keeps its workspaces: they move, in order, to the end of the ungrouped list. */
export function ungroupWorkspaces<T extends Pick<WorkspaceRecord, 'id' | 'groupId' | 'order' | 'name'>>(workspaces: T[], groupId: string): T[] {
  const ungroupedCount = workspacesInGroup(workspaces, null).length
  const updates = new Map(workspacesInGroup(workspaces, groupId).map((workspace, index) => [
    workspace.id, { ...workspace, groupId: null, order: ungroupedCount + index }
  ]))
  return workspaces.map((workspace) => updates.get(workspace.id) ?? workspace)
}

/** Next `order` for a workspace appended to `groupId`. */
export function nextOrderInGroup(workspaces: Array<Pick<WorkspaceRecord, 'groupId' | 'order'>>, groupId: string | null) {
  return workspaces
    .filter((workspace) => (workspace.groupId ?? null) === groupId)
    .reduce((max, workspace) => Math.max(max, workspace.order), -1) + 1
}

/** Apply a full group order; unknown ids are ignored and unlisted groups keep their place at the end. */
export function reorderGroups(groups: GroupRecord[], ids: string[]): GroupRecord[] {
  const listed = ids.map((id) => groups.find((group) => group.id === id)).filter((group): group is GroupRecord => Boolean(group))
  const rest = sortByOrder(groups.filter((group) => !ids.includes(group.id)))
  return [...listed, ...rest].map((group, order) => ({ ...group, order }))
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

/** Group colors are `#rrggbb` or null; anything else is rejected rather than stored. */
export function normalizeGroupColor(color: string | null | undefined): string | null {
  if (color === null || color === undefined || color === '') return null
  const trimmed = color.trim()
  if (!COLOR_PATTERN.test(trimmed)) throw new Error(`Invalid group color: ${color}`)
  return trimmed.toLowerCase()
}
