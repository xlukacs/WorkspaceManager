// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSession } from '@shared/types'
import { workspaceFromLegacy } from '@shared/workspaceModel'
import { TerminalDock } from '@renderer/components/TerminalDock'
import { useAppStore } from '@renderer/store/useAppStore'

vi.mock('@renderer/components/XTerminal', () => ({
  XTerminal: React.forwardRef(() => <div data-testid="xterm" />)
}))

const initialState = useAppStore.getState()

// v11-shaped fixture, converted the same way the store migration does.
const workspace = workspaceFromLegacy({
  id: 'project',
  name: 'demo',
  nameOverride: null,
  order: 0,
  rootPath: '/tmp/demo',
  groupIds: [],
  packageManager: 'pnpm',
  isMonorepo: false,
  rootScripts: {},
  workspacePackages: [],
  docker: null,
  pythonEnvironment: null,
  commandChains: {},
  favoriteCommandIds: [],
  lastScanAt: 1,
  quickLinks: [],
  gitSummary: null,
  gitWorktrees: [],
  gitWorktreesRoot: null
}, null)

function terminal(title: string, overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: title,
    projectId: null,
    workspaceId: workspace.id,
    commandId: `project::root::${title}`,
    title,
    pinned: false,
    workspacePaused: false,
    worktreePath: null,
    cwd: workspace.rootPath,
    shellLine: `pnpm run ${title}`,
    pythonEnvironment: null,
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    exitCode: null,
    buffer: '',
    restorable: true,
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

describe('console worktree filter', () => {
  it('shows branch labels for all checkouts and switches selection to a visible tab when filtered', () => {
    const tree = { path: workspace.rootPath, branch: 'main', head: null, isMain: true, isBare: false, isLocked: false, isDirty: false, isMissing: false, lastActivityAt: null, lastActivityRelative: null }
    const multi = { ...workspace, gitWorktrees: [tree, { ...tree, path: '/tmp/feature', branch: 'feature', isMain: false }] }
    useAppStore.setState({ ...initialState, bootstrapped: true, workspaces: [multi], selectedWorkspaceId: multi.id,
      terminals: [terminal('dev'), terminal('test', { worktreePath: '/tmp/feature' })], activeTerminalId: 'dev',
      selectedWorktreeByWorkspace: { [workspace.id]: '/tmp/feature' }
    }, true)
    render(<TerminalDock workspace={multi} />)
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('feature')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show consoles from this worktree only' }))
    expect(screen.queryByRole('button', { name: 'dev console' })).toBeNull()
    expect(screen.getByRole('button', { name: 'test console' })).toBeTruthy()
    expect(screen.getByText('This worktree')).toBeTruthy()
    expect(useAppStore.getState().activeTerminalId).toBe('test')
    expect(screen.queryByText('feature')).toBeNull()
    act(() => useAppStore.setState({ terminals: [terminal('dev')] }))
    expect(screen.getByText('No consoles in this worktree.')).toBeTruthy()
    expect(useAppStore.getState().activeTerminalId).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show consoles from this worktree only' }))
    expect(screen.getByRole('button', { name: 'dev console' })).toBeTruthy()
    expect(screen.getByText('All worktrees')).toBeTruthy()
  })
})

describe('resume warnings', () => {
  it.each(['group', 'workspace'] as const)('shows %s resume failures even when no console could restart', async (scope) => {
    Object.defineProperty(window, 'workspaceApi', { configurable: true, value: { terminals: {
      resumeGroup: async () => ({ sessions: [], warnings: ['API: Selected worktree is missing.'] }),
      resumeWorkspace: async () => ({ sessions: [], warnings: ['API: Selected worktree is missing.'] })
    } } })
    useAppStore.setState({ ...initialState, terminals: [terminal('dev', { status: 'stopped', workspacePaused: true })] }, true)
    render(<TerminalDock workspace={workspace} />)
    await act(async () => {
      if (scope === 'group') await useAppStore.getState().resumeGroupTerminals('group')
      else await useAppStore.getState().resumeWorkspaceTerminals(workspace.id)
    })
    expect(screen.getByText('API: Selected worktree is missing.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('API: Selected worktree is missing.')).toBeNull()
    delete (window as { workspaceApi?: unknown }).workspaceApi
  })
})

describe('TerminalDock console tab rename', () => {
  it('renames a console from the tab context menu', async () => {
    const renameTerminal = vi.fn(async () => undefined)
    useAppStore.setState({
      ...initialState,
      terminals: [terminal('dev'), terminal('test')],
      activeTerminalId: 'dev',
      renameTerminal
    }, true)

    render(<TerminalDock workspace={workspace} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'dev console' }))
    expect(screen.getByRole('menuitem', { name: 'Pin' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByLabelText('Rename dev')
    fireEvent.change(input, { target: { value: 'frontend' } })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(renameTerminal).toHaveBeenCalledWith('dev', 'frontend')
  })

  it('renames a console by double-clicking the tab', async () => {
    const renameTerminal = vi.fn(async () => undefined)
    useAppStore.setState({
      ...initialState,
      terminals: [terminal('dev')],
      activeTerminalId: 'dev',
      renameTerminal
    }, true)

    render(<TerminalDock workspace={workspace} />)

    fireEvent.doubleClick(screen.getByRole('button', { name: 'dev console' }))
    const input = screen.getByLabelText('Rename dev')
    fireEvent.change(input, { target: { value: 'api' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    expect(renameTerminal).toHaveBeenCalledWith('dev', 'api')
  })

  it('cancels an in-progress rename with Escape', () => {
    const renameTerminal = vi.fn(async () => undefined)
    useAppStore.setState({
      ...initialState,
      terminals: [terminal('dev')],
      activeTerminalId: 'dev',
      renameTerminal
    }, true)

    render(<TerminalDock workspace={workspace} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Rename dev')
    fireEvent.change(input, { target: { value: 'frontend' } })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.getByRole('button', { name: 'dev console' })).toBeTruthy()
    expect(renameTerminal).not.toHaveBeenCalled()
  })
})
