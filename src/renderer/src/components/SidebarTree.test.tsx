// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GroupRecord, WorkspaceRecord, TerminalSession } from '@shared/types'
import { SidebarTree } from '@renderer/components/SidebarTree'
import { useAppStore } from '@renderer/store/useAppStore'

const initialState = useAppStore.getState()

const groups: GroupRecord[] = [
  { id: 'back', name: 'Backend', order: 1, color: '#68d391' },
  { id: 'front', name: 'Frontend', order: 0, color: null }
]

function workspace(id: string, groupId: string | null, order: number): WorkspaceRecord {
  return {
    id, name: id, nameOverride: null, order, rootPath: `/repos/${id}`, groupId, openTarget: null,
    projects: [{
      id: 'root', name: id, relativePath: '', capabilities: ['node'], source: 'root',
      packageManager: 'pnpm', scripts: {}, docker: null, python: null
    }],
    commandChains: {}, favoriteCommandIds: [], runActions: [], defaultRunActionId: null, pinnedEndpoints: [],
    lastScanAt: 1, quickLinks: [], gitSummary: null, gitWorktrees: [], gitWorktreesRoot: null
  }
}

const workspaces = [
  workspace('web', 'front', 0), workspace('admin', 'front', 1),
  workspace('api', 'back', 0),
  workspace('scratch', null, 0)
]

function setup(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  const actions = {
    moveWorkspaceTo: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
    setGroupColor: vi.fn(async () => undefined),
    createGroup: vi.fn(async () => undefined),
    renameGroup: vi.fn(async () => undefined)
  }
  useAppStore.setState({ ...initialState, groups, workspaces, ...actions, ...overrides }, true)
  render(<SidebarTree />)
  return actions
}

function section(name: string) {
  return screen.getByRole('region', { name })
}

function rowNames(name: string) {
  return within(section(name)).queryAllByText(/^(web|admin|api|scratch)$/).map((element) => element.textContent)
}

function dataTransfer() {
  const data = new Map<string, string>()
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'move',
    dropEffect: 'move'
  }
}

function drag(workspaceName: string, onto: HTMLElement) {
  const transfer = dataTransfer()
  fireEvent.dragStart(screen.getByRole('button', { name: `Reorder ${workspaceName}` }), { dataTransfer: transfer })
  fireEvent.dragOver(onto, { dataTransfer: transfer })
  fireEvent.drop(onto, { dataTransfer: transfer })
}

function openMenu(label: string, item: string) {
  fireEvent.click(screen.getByRole('button', { name: `${label} actions` }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
  vi.restoreAllMocks()
})

describe('SidebarTree', () => {
  it('shows groups in order with their workspaces and Ungrouped last', () => {
    setup()
    const sections = screen.getAllByRole('region').map((element) => element.getAttribute('aria-label'))
    expect(sections).toEqual(['Frontend', 'Backend', 'Ungrouped'])
    expect(rowNames('Frontend')).toEqual(['web', 'admin'])
    expect(rowNames('Ungrouped')).toEqual(['scratch'])
  })

  it('offers group pause, resume and confirmed kill actions', () => {
    const pauseGroupTerminals = vi.fn(async () => {})
    const resumeGroupTerminals = vi.fn(async () => {})
    const killGroupTerminals = vi.fn(async () => {})
    const base: TerminalSession = {
      id: 'dev', workspaceId: 'web', projectId: null, commandId: 'cmd', title: 'Dev', pinned: false,
      worktreePath: null, cwd: '/repos/web', shellLine: 'pnpm dev', pythonEnvironment: null,
      status: 'running', createdAt: 1, updatedAt: 1, exitCode: null, buffer: '', restorable: true, workspacePaused: false
    }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup({ terminals: [base, { ...base, id: 'paused', status: 'stopped', workspacePaused: true }], pauseGroupTerminals, resumeGroupTerminals, killGroupTerminals })
    openMenu('Frontend', 'Pause group consoles')
    expect(pauseGroupTerminals).toHaveBeenCalledWith('front')
    openMenu('Frontend', 'Resume group consoles')
    expect(resumeGroupTerminals).toHaveBeenCalledWith('front')
    openMenu('Frontend', 'Kill group consoles')
    expect(killGroupTerminals).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    openMenu('Frontend', 'Kill group consoles')
    expect(killGroupTerminals).toHaveBeenCalledWith('front')
  })

  it('allows removing a group containing only finished pinned consoles and explains history removal', () => {
    const killGroupTerminals = vi.fn(async () => {})
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    setup({ terminals: [{
      id: 'done', workspaceId: 'web', projectId: null, commandId: 'cmd', title: 'Build', pinned: true,
      worktreePath: null, cwd: '/repos/web', shellLine: 'pnpm build', pythonEnvironment: null,
      status: 'exited', createdAt: 1, updatedAt: 1, exitCode: 0, buffer: 'done', restorable: true, workspacePaused: false
    }], killGroupTerminals })
    openMenu('Frontend', 'Kill group consoles')
    expect(killGroupTerminals).toHaveBeenCalledWith('front')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('remove'))
  })

  it('collapses and expands a group', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Frontend' }))
    expect(rowNames('Frontend')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Expand Frontend' }))
    expect(rowNames('Frontend')).toEqual(['web', 'admin'])
  })

  it('drops a workspace on a group header to append it to that group', () => {
    const { moveWorkspaceTo } = setup()
    const header = within(section('Backend')).getByRole('button', { name: 'Collapse Backend' }).parentElement!
    drag('web', header)
    expect(moveWorkspaceTo).toHaveBeenCalledWith('web', 'back', 1)
  })

  it('drops a workspace on another workspace to take its place, across groups', () => {
    const { moveWorkspaceTo } = setup()
    const adminRow = screen.getByRole('button', { name: 'Reorder admin' }).parentElement!
    drag('scratch', adminRow)
    expect(moveWorkspaceTo).toHaveBeenCalledWith('scratch', 'front', 1)
  })

  it('moves a workspace through the "Move to group" form, including to Ungrouped', () => {
    const { moveWorkspaceTo } = setup()
    openMenu('api', 'Move to group…')
    fireEvent.change(screen.getByRole('combobox', { name: 'Destination group' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(moveWorkspaceTo).toHaveBeenCalledWith('api', null, 1)
  })

  it('deletes a group only after confirmation', () => {
    const { deleteGroup } = setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    openMenu('Backend', 'Delete group')
    expect(deleteGroup).not.toHaveBeenCalled()
    openMenu('Backend', 'Delete group')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(deleteGroup).toHaveBeenCalledWith('back')
  })

  it('sets and clears a group color', () => {
    const { setGroupColor } = setup()
    openMenu('Frontend', 'Set color…')
    fireEvent.click(screen.getByRole('button', { name: 'Use #c084fc' }))
    expect(setGroupColor).toHaveBeenCalledWith('front', '#c084fc')
    openMenu('Backend', 'Set color…')
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(setGroupColor).toHaveBeenLastCalledWith('back', null)
  })

  it('creates and renames groups inline', () => {
    const { createGroup, renameGroup } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New group name' }), { target: { value: '  Infra ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(createGroup).toHaveBeenCalledWith('Infra')
    openMenu('Frontend', 'Rename')
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename Frontend' }), { target: { value: 'Web' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(renameGroup).toHaveBeenCalledWith('front', 'Web')
  })

  it('shows only matching workspaces while searching, ignoring collapse', () => {
    setup({ search: 'adm', collapsedGroupIds: ['front'] })
    expect(screen.getAllByRole('region').map((element) => element.getAttribute('aria-label'))).toEqual(['Frontend'])
    expect(rowNames('Frontend')).toEqual(['admin'])
  })
})
