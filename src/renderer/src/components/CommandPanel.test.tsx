// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandListResponse } from '@shared/types'
import { workspaceFromLegacy } from '@shared/workspaceModel'
import { CommandPanel } from '@renderer/components/CommandPanel'
import { useAppStore } from '@renderer/store/useAppStore'

const initialState = useAppStore.getState()

// v11-shaped fixture, converted the same way the store migration does.
const workspace = workspaceFromLegacy({
  id: 'project',
  name: 'demo',
  nameOverride: null,
  order: 0,
  rootPath: '/tmp/demo',
  groupIds: ['active'],
  packageManager: 'pnpm',
  isMonorepo: false,
  rootScripts: {
    frontend: 'pnpm run frontend',
    'frontend:dev': 'pnpm run frontend:dev'
  },
  workspacePackages: [],
  docker: null,
  pythonEnvironment: null,
  commandChains: {
    'project::root::frontend:dev': ['project::root::frontend']
  },
  favoriteCommandIds: [],
  lastScanAt: Date.now(),
  quickLinks: [],
  gitSummary: null,
  gitWorktrees: [],
  gitWorktreesRoot: null
}, null)

const commandList: CommandListResponse = {
  favorites: [],
  groups: [{
    key: 'root',
    title: 'Root Scripts',
    commands: [
      {
        id: 'project::root::frontend',
        workspaceId: 'project',
        scope: 'root',
        name: 'frontend',
        script: 'pnpm run frontend',
        title: 'frontend',
        packageManager: 'pnpm',
        cwd: '/tmp/demo',
        rank: 90,
        favorite: false,
        prerequisiteCommandIds: [],
        prerequisiteTitles: [],
        hasChain: false
      },
      {
        id: 'project::root::frontend:dev',
        workspaceId: 'project',
        scope: 'root',
        name: 'frontend:dev',
        script: 'pnpm run frontend:dev',
        title: 'frontend:dev',
        packageManager: 'pnpm',
        cwd: '/tmp/demo',
        rank: 100,
        favorite: false,
        prerequisiteCommandIds: ['project::root::frontend'],
        prerequisiteTitles: ['frontend'],
        hasChain: true
      },
      {
        id: 'project::root::backend',
        workspaceId: 'project',
        scope: 'root',
        name: 'backend',
        script: 'pnpm run backend',
        title: 'backend',
        packageManager: 'pnpm',
        cwd: '/tmp/demo',
        rank: 80,
        favorite: false,
        prerequisiteCommandIds: [],
        prerequisiteTitles: [],
        hasChain: false
      }
    ]
  }]
}

const emptyChainCommandList: CommandListResponse = {
  favorites: [],
  groups: [{
    key: 'root',
    title: 'Root Scripts',
    commands: commandList.groups[0]!.commands.map((command) => ({
      ...command,
      prerequisiteCommandIds: [],
      prerequisiteTitles: [],
      hasChain: false
    }))
  }]
}

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CommandPanel', () => {
  it('shows prerequisite summary for configured commands', () => {
    useAppStore.setState({
      ...initialState,
      commandLists: { [workspace.id]: commandList }
    }, true)

    render(<CommandPanel workspace={workspace} />)

    expect(screen.getByText('Pre: frontend')).toBeTruthy()
  })

  it('filters command results after the search debounce period', () => {
    vi.useFakeTimers()
    useAppStore.setState({
      ...initialState,
      commandLists: { [workspace.id]: commandList }
    }, true)

    render(<CommandPanel workspace={workspace} />)

    fireEvent.change(screen.getByPlaceholderText('Filter by name, script, or project'), {
      target: { value: 'backend' }
    })

    expect(screen.getByText('frontend')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(screen.getByText('backend')).toBeTruthy()
    expect(screen.queryByText('frontend')).toBeNull()
  })

  it('opens the inline steps editor and saves prerequisite changes', async () => {
    const setCommandChain = vi.fn(async () => undefined)
    useAppStore.setState({
      ...initialState,
      commandLists: { [workspace.id]: emptyChainCommandList },
      runCommand: vi.fn(async () => undefined),
      toggleFavoriteCommand: vi.fn(async () => undefined),
      setCommandChain
    }, true)

    render(<CommandPanel workspace={workspace} />)

    const configureButtons = screen.getAllByTitle('Configure steps')
    fireEvent.click(configureButtons[1])

    expect(screen.getByText('No prerequisite steps yet.')).toBeTruthy()

    const select = screen.getByDisplayValue('Add prerequisite…')
    fireEvent.change(select, { target: { value: 'project::root::frontend' } })
    fireEvent.click(screen.getByLabelText('Add prerequisite'))

    const saveButton = screen.getByLabelText('Save steps')
    fireEvent.click(saveButton)

    expect(setCommandChain).toHaveBeenCalledWith(workspace.id, 'project::root::frontend:dev', [
      'project::root::frontend'
    ])
    await waitFor(() => expect(screen.queryByText('No prerequisite steps yet.')).toBeNull())
  })

  it('can remove prerequisite steps inside the editor', () => {
    useAppStore.setState({
      ...initialState,
      commandLists: { [workspace.id]: commandList },
      runCommand: vi.fn(async () => undefined),
      toggleFavoriteCommand: vi.fn(async () => undefined),
      setCommandChain: vi.fn(async () => undefined)
    }, true)

    render(<CommandPanel workspace={workspace} />)

    fireEvent.click(screen.getAllByTitle('Configure steps')[1])
    const removeButton = screen.getByTitle('Remove step')
    const editor = removeButton.closest('.command-chain-editor')
    expect(editor).toBeTruthy()

    fireEvent.click(removeButton)

    expect(within(editor as HTMLElement).getByText('No prerequisite steps yet.')).toBeTruthy()
  })

  describe('mixed detected projects', () => {
    const command = (id: string, projectId: string, name: string, kind: 'script' | 'docker' | 'run-action', script: string) => ({
      id: `p1::${id}`, workspaceId: 'p1', scope: 'project' as const, kind, projectId, name, script, title: name,
      packageManager: 'pnpm' as const, cwd: '/repos/product', rank: 50, favorite: false,
      prerequisiteCommandIds: [], prerequisiteTitles: [], hasChain: false
    })
    const mixed: CommandListResponse = {
      favorites: [],
      groups: [
        { key: 'web', title: 'web', projectId: 'web', relativePath: 'apps/web', capabilities: ['node'], commands: [command('web::dev', 'web', 'dev', 'script', 'vite')] },
        { key: 'api', title: 'api', projectId: 'api', relativePath: 'services/api', capabilities: ['python'], commands: [command('api::synthetic::python-install', 'api', 'python:install', 'script', '.venv/bin/python -m pip install -r requirements.txt')] },
        { key: 'infra', title: 'infrastructure', projectId: 'infra', relativePath: 'infrastructure', capabilities: ['docker'], commands: [command('infra::docker::compose-up', 'infra', 'Compose Up', 'docker', 'docker compose up')] }
      ]
    }

    function renderMixed(setCommandChain = vi.fn(async () => undefined)) {
      useAppStore.setState({
        ...initialState,
        commandLists: { [workspace.id]: mixed },
        runCommand: vi.fn(async () => undefined),
        toggleFavoriteCommand: vi.fn(async () => undefined),
        setCommandChain
      }, true)
      render(<CommandPanel workspace={workspace} />)
      return setCommandChain
    }

    it('heads each project with its folder and capability badges', () => {
      renderMixed()
      expect(screen.getByText('services/api')).toBeTruthy()
      expect(screen.getByLabelText('Capabilities: Python')).toBeTruthy()
      expect(screen.getByLabelText('Capabilities: Docker')).toBeTruthy()
      expect(screen.getByText('Docker', { selector: '.command-kind-badge' })).toBeTruthy()
    })

    it('finds a whole project by its folder', () => {
      vi.useFakeTimers()
      try {
        renderMixed()
        fireEvent.change(screen.getByPlaceholderText('Filter by name, script, or project'), { target: { value: 'infrastructure' } })
        act(() => { vi.advanceTimersByTime(300) })
        expect(screen.getByText('Compose Up')).toBeTruthy()
        expect(screen.queryByText('python:install')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('chains prerequisites from other projects and kinds', () => {
      const setCommandChain = renderMixed()
      fireEvent.click(screen.getByLabelText('Configure steps for dev'))
      const select = screen.getByRole('combobox', { name: 'Prerequisite command' })
      expect(within(select).getAllByRole('group').map((group) => group.getAttribute('label'))).toEqual([
        'api (services/api)', 'infrastructure (infrastructure)'
      ])
      expect(within(select).getByRole('option', { name: 'Compose Up · Docker' })).toBeTruthy()
      for (const id of ['p1::api::synthetic::python-install', 'p1::infra::docker::compose-up']) {
        fireEvent.change(select, { target: { value: id } })
        fireEvent.click(screen.getByLabelText('Add prerequisite'))
      }
      fireEvent.click(screen.getByLabelText('Save steps'))
      expect(setCommandChain).toHaveBeenCalledWith(workspace.id, 'p1::web::dev', [
        'p1::api::synthetic::python-install', 'p1::infra::docker::compose-up'
      ])
    })
  })
})
