// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '@shared/fixtures/store-v11.json'
import type { PersistedState } from '@shared/persistedState'
import { decodeWorkspaceState } from '@shared/workspaceModel'
import { useAppStore } from '@renderer/store/useAppStore'
import { useWorkspaceHotkeys } from './useWorkspaceHotkeys'

const initial = useAppStore.getState()
const state = decodeWorkspaceState(fixture as PersistedState)
const tree = { path: '/repo/main', branch: 'main', head: null, isMain: true, isBare: false, isLocked: false, isDirty: false, isMissing: false, lastActivityAt: null, lastActivityRelative: null }
const workspace = { ...state.workspaces[0]!, rootPath: tree.path, gitWorktrees: [tree, { ...tree, path: '/repo/feature', branch: 'feature', isMain: false }] }
const session = { ...state.terminals[0]!, status: 'running' as const, workspaceId: workspace.id }
const sessions = [{ ...session, id: 'main', worktreePath: null }, { ...session, id: 'feature1', worktreePath: '/repo/feature' }, { ...session, id: 'feature2', worktreePath: '/repo/feature' }]

function setup() {
  const actions = { restartTerminal: vi.fn(async () => {}), setSelectedWorkspace: vi.fn(async () => {}), stopTerminal: vi.fn(async () => {}) }
  const openPath = vi.fn(async () => {})
  Object.defineProperty(window, 'workspaceApi', { configurable: true, value: { system: { openPath } } })
  useAppStore.setState({ ...initial, ...actions, bootstrapped: true, groups: state.groups,
    workspaces: [workspace, { ...workspace, id: 'second', name: 'Second', order: 1 }],
    selectedWorkspaceId: workspace.id, selectedWorktreeByWorkspace: { [workspace.id]: '/repo/feature' },
    terminals: sessions, activeTerminalId: 'feature1', consoleTabFilter: 'worktree'
  }, true)
  renderHook(useWorkspaceHotkeys)
  return { ...actions, openPath }
}

afterEach(() => {
  cleanup()
  useAppStore.setState(initial, true)
  delete (window as { workspaceApi?: unknown }).workspaceApi
  document.body.innerHTML = ''
})

describe('workspace shortcuts', () => {
  it('selects workspaces in sidebar order and consoles in visible tab order', () => {
    const actions = setup()
    fireEvent.keyDown(window, { key: '2', ctrlKey: true })
    expect(actions.setSelectedWorkspace).toHaveBeenCalledWith('second')
    fireEvent.keyDown(window, { key: '2', altKey: true })
    expect(useAppStore.getState().activeTerminalId).toBe('feature2')
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true })
    expect(useAppStore.getState().activeTerminalId).toBe('feature1')
    fireEvent.keyDown(window, { key: ' ' })
    expect(actions.stopTerminal).toHaveBeenCalledWith('feature1')
  })

  it('restarts the active visible console and opens the selected checkout in the file manager', () => {
    const actions = setup()
    fireEvent.keyDown(window, { key: 'r' })
    expect(actions.restartTerminal).toHaveBeenCalledWith('feature1')
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(actions.openPath).toHaveBeenCalledWith('/repo/feature')
  })

  it('leaves typing and repeated keys alone, but supports console selection from terminal input', () => {
    const actions = setup()
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'r' })
    fireEvent.keyDown(input, { key: '2', altKey: true })
    fireEvent.keyDown(window, { key: 'r', repeat: true })
    expect(actions.restartTerminal).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeTerminalId).toBe('feature1')
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    const textarea = document.createElement('textarea')
    terminal.append(textarea)
    document.body.append(terminal)
    fireEvent.keyDown(textarea, { key: 'r' })
    expect(actions.restartTerminal).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: '2', altKey: true })
    expect(useAppStore.getState().activeTerminalId).toBe('feature2')
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(useAppStore.getState().sidebarCollapsed).toBe(false)
    act(() => useAppStore.setState({ importDrawerOpen: true }))
    fireEvent.keyDown(window, { key: 'r' })
    expect(actions.restartTerminal).not.toHaveBeenCalled()
  })
})
