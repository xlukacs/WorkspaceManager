// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSession } from '@shared/types'
import { workspaceFromLegacy } from '@shared/workspaceModel'
import { Sidebar } from '@renderer/components/Sidebar'
import { useAppStore } from '@renderer/store/useAppStore'

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

function terminal(id: string, status: TerminalSession['status'], workspacePaused: boolean): TerminalSession {
  return {
    id,
    projectId: null,
    workspaceId: workspace.id,
    commandId: `project::root::${id}`,
    title: id,
    pinned: false,
    workspacePaused,
    worktreePath: null,
    cwd: workspace.rootPath,
    shellLine: `pnpm run ${id}`,
    pythonEnvironment: null,
    status,
    createdAt: 1,
    updatedAt: 1,
    exitCode: null,
    buffer: '',
    restorable: true
  }
}

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

describe('Sidebar project pause control', () => {
  it('keeps the pause action when a project has both running and paused consoles', () => {
    const pauseWorkspaceTerminals = vi.fn(async () => undefined)
    const resumeWorkspaceTerminals = vi.fn(async () => undefined)
    useAppStore.setState({
      ...initialState,
      workspaces: [workspace],
      sidebarCollapsed: true,
      terminals: [
        terminal('dev', 'running', false),
        terminal('previous-dev', 'stopped', true)
      ],
      pauseWorkspaceTerminals,
      resumeWorkspaceTerminals
    }, true)

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Pause workspace consoles: demo' }))

    expect(pauseWorkspaceTerminals).toHaveBeenCalledWith(workspace.id)
    expect(resumeWorkspaceTerminals).not.toHaveBeenCalled()
  })
})
