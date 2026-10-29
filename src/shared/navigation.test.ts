import { describe, expect, it } from 'vitest'
import type { PersistedState } from './persistedState'
import fixture from './fixtures/store-v11.json'
import { decodeWorkspaceState } from './workspaceModel'
import { resolveSelectedWorktreePath } from './worktreeExecution'
import { defaultUiState, normalizeUiState, UNGROUPED_KEY, visibleConsoleSessions } from './navigation'

const state = decodeWorkspaceState(fixture as PersistedState)
const base = state.workspaces[0]!
const tree = { path: '/repo/main', branch: 'main', head: null, isMain: true, isBare: false, isLocked: false, isDirty: false, isMissing: false, lastActivityAt: null, lastActivityRelative: null }
const workspace = { ...base, rootPath: tree.path, gitWorktrees: [tree, { ...tree, path: '/repo/feature', branch: 'feature', isMain: false }] }

describe('saved navigation', () => {
  it('restores live selections and drops deleted groups/workspaces and unknown checkouts', () => {
    expect(normalizeUiState({
      selectedGroupId: 'deleted', selectedWorkspaceId: 'deleted',
      selectedWorktreeByWorkspace: { [base.id]: '/repo/deleted', deleted: '/repo/deleted' },
      collapsedGroupIds: ['active', 'deleted', UNGROUPED_KEY, 'active']
    }, state.groups, [workspace])).toEqual({
      ...defaultUiState(), selectedWorkspaceId: base.id, selectedGroupId: base.groupId,
      selectedWorktreeByWorkspace: { [base.id]: tree.path }, collapsedGroupIds: ['active', UNGROUPED_KEY]
    })
  })

  it('falls back for both flagged and physically missing worktrees', () => {
    const ui = { selectedWorktreeByWorkspace: { [base.id]: '/repo/feature' } }
    expect(normalizeUiState(ui, state.groups, [workspace], (path) => path !== '/repo/feature').selectedWorktreeByWorkspace[base.id]).toBe(tree.path)
    const flagged = { ...workspace, gitWorktrees: workspace.gitWorktrees.map((entry) => ({ ...entry, isMissing: entry.branch === 'feature' })) }
    expect(normalizeUiState(ui, state.groups, [flagged]).selectedWorktreeByWorkspace[base.id]).toBe(tree.path)
    expect(resolveSelectedWorktreePath(flagged, '/repo/feature')).toBe(tree.path)
  })

  it('defaults to all consoles and filters by selected checkout, including old sessions without a worktree path', () => {
    const session = { ...state.terminals[0]!, workspaceId: workspace.id }
    const terminals = [{ ...session, id: 'old', worktreePath: null }, { ...session, id: 'feature', worktreePath: '/repo/feature' }, { ...session, id: 'other', workspaceId: 'other' }]
    expect(visibleConsoleSessions(terminals, workspace, defaultUiState().consoleTabFilter).map((entry) => entry.id)).toEqual(['old', 'feature'])
    expect(visibleConsoleSessions(terminals, workspace, 'worktree', '/repo/feature').map((entry) => entry.id)).toEqual(['feature'])
    expect(visibleConsoleSessions(terminals, workspace, 'worktree', tree.path).map((entry) => entry.id)).toEqual(['old'])
  })
})
