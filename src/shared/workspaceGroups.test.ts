import { describe, expect, it } from 'vitest'
import {
  groupWorkspaces,
  moveWorkspaceToGroup,
  nextOrderInGroup,
  normalizeGroupColor,
  reorderGroups,
  sortWorkspacesForSidebar,
  ungroupWorkspaces,
  workspacesInGroup
} from '@shared/workspaceGroups'

const ws = (id: string, groupId: string | null, order: number) => ({ id, name: id, groupId, order })

const workspaces = [
  ws('a', 'front', 0), ws('b', 'front', 1), ws('c', 'front', 2),
  ws('d', 'back', 0), ws('e', 'back', 1),
  ws('u', null, 0)
]

const ids = (list: typeof workspaces, groupId: string | null) => workspacesInGroup(list, groupId).map((workspace) => workspace.id)

describe('workspace groups', () => {
  it('reorders within a group and keeps orders contiguous', () => {
    const moved = moveWorkspaceToGroup(workspaces, { workspaceId: 'c', groupId: 'front', index: 0 })
    expect(ids(moved, 'front')).toEqual(['c', 'a', 'b'])
    expect(workspacesInGroup(moved, 'front').map((workspace) => workspace.order)).toEqual([0, 1, 2])
    expect(ids(moved, 'back')).toEqual(['d', 'e'])
  })

  it('moves between groups and renumbers the source group', () => {
    const moved = moveWorkspaceToGroup(workspaces, { workspaceId: 'a', groupId: 'back', index: 1 })
    expect(ids(moved, 'back')).toEqual(['d', 'a', 'e'])
    expect(ids(moved, 'front')).toEqual(['b', 'c'])
    expect(moved.find((workspace) => workspace.id === 'b')?.order).toBe(0)
  })

  it('moves into and out of the ungrouped section, clamping the index', () => {
    const ungrouped = moveWorkspaceToGroup(workspaces, { workspaceId: 'e', groupId: null, index: 99 })
    expect(ids(ungrouped, null)).toEqual(['u', 'e'])
    const regrouped = moveWorkspaceToGroup(ungrouped, { workspaceId: 'u', groupId: 'front', index: -4 })
    expect(ids(regrouped, 'front')).toEqual(['u', 'a', 'b', 'c'])
    expect(ids(regrouped, null)).toEqual(['e'])
  })

  it('ignores unknown workspaces', () => {
    expect(moveWorkspaceToGroup(workspaces, { workspaceId: 'zz', groupId: null, index: 0 })).toBe(workspaces)
  })

  it('ungroups the workspaces of a deleted group after the existing ungrouped ones', () => {
    const next = ungroupWorkspaces(workspaces, 'front')
    expect(ids(next, null)).toEqual(['u', 'a', 'b', 'c'])
    expect(ids(next, 'back')).toEqual(['d', 'e'])
  })

  it('appends to the end of a group', () => {
    expect(nextOrderInGroup(workspaces, 'front')).toBe(3)
    expect(nextOrderInGroup(workspaces, 'empty')).toBe(0)
  })

  it('applies a group order and keeps unlisted groups at the end', () => {
    const groups = [
      { id: 'x', name: 'X', order: 0, color: null },
      { id: 'y', name: 'Y', order: 1, color: '#ff0000' },
      { id: 'z', name: 'Z', order: 2, color: null }
    ]
    expect(reorderGroups(groups, ['z', 'x', 'missing']).map((group) => [group.id, group.order])).toEqual([
      ['z', 0], ['x', 1], ['y', 2]
    ])
  })

  it('accepts only #rrggbb colors', () => {
    expect(normalizeGroupColor('#AABBCC')).toBe('#aabbcc')
    expect(normalizeGroupColor(null)).toBeNull()
    expect(normalizeGroupColor('')).toBeNull()
    expect(() => normalizeGroupColor('red')).toThrow('Invalid group color')
  })

  it('builds the sidebar tree with ungrouped and orphaned workspaces last', () => {
    const groups = [
      { id: 'back', name: 'Backend', order: 1, color: null },
      { id: 'front', name: 'Frontend', order: 0, color: null }
    ]
    const withOrphan = [...workspaces, ws('o', 'deleted-group', 0)]
    const tree = groupWorkspaces(groups, withOrphan)
    expect(tree.groups.map((entry) => [entry.group.id, entry.workspaces.map((workspace) => workspace.id)])).toEqual([
      ['front', ['a', 'b', 'c']], ['back', ['d', 'e']]
    ])
    expect(tree.ungrouped.map((workspace) => workspace.id)).toEqual(['o', 'u'])
    expect(sortWorkspacesForSidebar(groups, withOrphan).map((workspace) => workspace.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'o', 'u'])
  })
})
