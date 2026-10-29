// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import legacyState from '@shared/fixtures/store-v11.json'
import type { PersistedState } from '@shared/persistedState'
import { decodeWorkspaceState } from '@shared/workspaceModel'
import { defaultUiState } from '@shared/navigation'
import { useAppStore } from './useAppStore'

const initialState = useAppStore.getState()
const fixture = decodeWorkspaceState(legacyState as PersistedState)
const workspace = fixture.workspaces[0]!

afterEach(() => {
  useAppStore.setState(initialState, true)
  delete (window as { workspaceApi?: unknown }).workspaceApi
})

describe('workspace store vocabulary', () => {
  it('removes killed group consoles from the deck and selects a remaining visible console', async () => {
    const base = { ...fixture.terminals[0]!, workspaceId: workspace.id }
    const removed = { ...base, id: 'killed', pinned: true }
    const remaining = { ...base, id: 'remaining', worktreePath: workspace.rootPath }
    const hidden = { ...base, id: 'hidden', worktreePath: '/other-checkout' }
    Object.defineProperty(window, 'workspaceApi', { configurable: true, value: {
      terminals: { killGroup: vi.fn(async () => [removed]) }
    } })
    useAppStore.setState({ workspaces: [workspace], selectedWorkspaceId: workspace.id, selectedWorktreeByWorkspace: { [workspace.id]: workspace.rootPath },
      consoleTabFilter: 'worktree', terminals: [removed, hidden, remaining], activeTerminalId: removed.id })
    await useAppStore.getState().killGroupTerminals('active')
    expect(useAppStore.getState().terminals.map((session) => session.id)).toEqual(['hidden', 'remaining'])
    expect(useAppStore.getState().activeTerminalId).toBe(remaining.id)
  })

  it('restores navigation on bootstrap and saves only navigation changes through the store API', async () => {
    const second = { ...workspace, id: 'second', name: 'Second', groupId: 'backend', order: 1 }
    let saved: ReturnType<typeof defaultUiState> = { ...defaultUiState(), selectedWorkspaceId: 'second', selectedGroupId: 'backend', sidebarCollapsed: false, collapsedGroupIds: ['active'], consoleTabFilter: 'worktree' as const }
    const save = vi.fn(async (ui: typeof saved) => { saved = ui })
    const list = vi.fn(async () => ({ favorites: [], groups: [] }))
    Object.defineProperty(window, 'workspaceApi', { configurable: true, value: {
      ui: { get: async () => saved, set: save },
      groups: { list: async () => fixture.groups },
      workspaces: { list: async () => [workspace, second], startupRescan: async () => {} },
      terminals: { restore: async () => fixture.terminals },
      commands: { list }, docker: { list }, system: { migrationNotes: async () => [] }
    } })
    await useAppStore.getState().bootstrap()
    expect(useAppStore.getState()).toMatchObject({ selectedWorkspaceId: 'second', selectedGroupId: 'backend', sidebarCollapsed: false, collapsedGroupIds: ['active'], consoleTabFilter: 'worktree' })
    expect(list).toHaveBeenCalledWith('second')
    save.mockClear()
    useAppStore.setState({ terminals: fixture.terminals.map((session) => ({ ...session, buffer: 'more output' })) })
    expect(save).not.toHaveBeenCalled()
    useAppStore.getState().toggleSidebar()
    useAppStore.getState().toggleConsoleTabFilter()
    useAppStore.getState().toggleGroupCollapsed('backend')
    expect(saved).toMatchObject({ selectedWorkspaceId: 'second', sidebarCollapsed: true, collapsedGroupIds: ['active', 'backend'], consoleTabFilter: 'all' })
    useAppStore.setState(initialState, true)
    await useAppStore.getState().bootstrap()
    expect(useAppStore.getState()).toMatchObject({ selectedWorkspaceId: 'second', sidebarCollapsed: true, collapsedGroupIds: ['active', 'backend'], consoleTabFilter: 'all' })
  })

  it('ungroups the workspaces of a deleted group', async () => {
    const removeGroup = vi.fn(async () => [{ ...workspace, groupId: null }])
    Object.defineProperty(window, 'workspaceApi', {
      configurable: true,
      value: { groups: { delete: removeGroup } }
    })
    useAppStore.setState({ groups: fixture.groups, workspaces: fixture.workspaces, selectedGroupId: 'active' })

    await useAppStore.getState().deleteGroup('active')

    expect(removeGroup).toHaveBeenCalledWith('active')
    expect(useAppStore.getState().groups.map((group) => group.id)).toEqual(['backend'])
    expect(useAppStore.getState().workspaces[0]?.groupId).toBeNull()
    expect(useAppStore.getState().selectedGroupId).toBe('all')
  })

  it('updates workspace and worktree selection after cleanup removes a selected checkout', async () => {
    const removedPath = '/repos/demo-feature'
    const updatedWorkspace = { ...workspace, lastScanAt: 456 }
    const cleanup = vi.fn(async () => ({
      workspace: updatedWorkspace, removedPaths: [removedPath], skipped: [], errors: []
    }))
    Object.defineProperty(window, 'workspaceApi', {
      configurable: true,
      value: { git: { cleanupWorktrees: cleanup }, terminals: { list: async () => [] } }
    })
    useAppStore.setState({
      workspaces: [workspace, { ...workspace, id: 'linked', rootPath: removedPath }],
      selectedWorkspaceId: 'linked',
      selectedWorktreeByWorkspace: { [workspace.id]: removedPath }
    })

    await useAppStore.getState().cleanupGitWorktrees({ workspaceId: workspace.id, maxAgeDays: 7 })

    const state = useAppStore.getState()
    expect(state.workspaces).toEqual([updatedWorkspace])
    expect(state.selectedWorkspaceId).toBe(workspace.id)
    expect(state.selectedWorktreeByWorkspace[workspace.id]).toBe(workspace.rootPath)
    expect(state.lastActionError).toBeNull()
  })

  it('moves a workspace between groups locally and keeps the main process result', async () => {
    const two = [
      { ...workspace, id: 'a', name: 'A', groupId: 'active', order: 0 },
      { ...workspace, id: 'b', name: 'B', groupId: 'backend', order: 0 }
    ]
    const authoritative = [{ ...two[0]!, groupId: 'backend', order: 1 }, two[1]!]
    const move = vi.fn(async () => authoritative)
    Object.defineProperty(window, 'workspaceApi', { configurable: true, value: { workspaces: { move } } })
    useAppStore.setState({ groups: fixture.groups, workspaces: two })

    await useAppStore.getState().moveWorkspaceTo('a', 'backend', 1)

    expect(move).toHaveBeenCalledWith({ workspaceId: 'a', groupId: 'backend', index: 1 })
    expect(useAppStore.getState().workspaces.find((entry) => entry.id === 'a')).toMatchObject({ groupId: 'backend', order: 1 })
  })

  it('restores the previous layout when a move fails', async () => {
    const before = [{ ...workspace, id: 'a', name: 'A', groupId: 'active', order: 0 }]
    Object.defineProperty(window, 'workspaceApi', {
      configurable: true,
      value: { workspaces: { move: vi.fn(async () => { throw new Error('Unknown group: gone') }) } }
    })
    useAppStore.setState({ groups: fixture.groups, workspaces: before, lastActionError: null })

    await useAppStore.getState().moveWorkspaceTo('a', 'gone', 0)

    expect(useAppStore.getState().workspaces).toEqual(before)
    expect(useAppStore.getState().lastActionError).toBe('Unknown group: gone')
  })
})
