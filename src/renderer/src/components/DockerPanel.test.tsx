// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import legacy from '@shared/fixtures/store-v11.json'
import type { PersistedState } from '@shared/persistedState'
import { decodeWorkspaceState } from '@shared/workspaceModel'
import type { CommandDescriptor, DockerCommandDescriptor } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { DockerPanel } from './DockerPanel'

const initial = useAppStore.getState()
afterEach(() => { cleanup(); useAppStore.setState(initial, true) })

it('shows Docker subprojects without root Docker config and accepts Python prerequisites', async () => {
  const decoded = decodeWorkspaceState(legacy as PersistedState).workspaces[0]!
  const workspace = {
    ...decoded,
    projects: decoded.projects.map((project) => project.id === 'root'
      ? { ...project, docker: null, capabilities: project.capabilities.filter((capability) => capability !== 'docker') }
      : project)
  }
  const python: CommandDescriptor = {
    id: 'p1::api::synthetic::python-install', workspaceId: 'p1', projectId: 'api', projectName: 'api',
    scope: 'project', name: 'python:install', title: 'api · python:install', script: 'python -m pip install -r requirements.txt',
    packageManager: 'unknown', cwd: '/repos/demo/services/api', rank: 68, favorite: false,
    prerequisiteCommandIds: [], prerequisiteTitles: [], hasChain: false
  }
  const docker: DockerCommandDescriptor = {
    id: 'p1::infra::docker::compose-up', workspaceId: 'p1', title: 'infra · Compose Up',
    description: 'Start the stack', shellLine: 'docker compose up', cwd: '/repos/demo/infrastructure', rank: 100,
    prerequisiteCommandIds: [], prerequisiteTitles: [], hasChain: false
  }
  const setCommandChain = vi.fn(async () => {})
  useAppStore.setState({
    commandLists: { p1: { favorites: [], groups: [{ key: 'api', title: 'api', commands: [python] }] } },
    dockerLists: { p1: { groups: [{ key: 'infra', title: 'infra', commands: [docker] }] } },
    setCommandChain
  })
  render(<DockerPanel workspace={workspace} />)
  expect(screen.getByRole('button', { name: 'Run infra · Compose Up' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Configure steps for infra · Compose Up' }))
  fireEvent.change(screen.getByDisplayValue('Add prerequisite…'), { target: { value: python.id } })
  fireEvent.click(screen.getByRole('button', { name: 'Add prerequisite' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save steps' })) })
  expect(setCommandChain).toHaveBeenCalledWith('p1', docker.id, [python.id])
  expect(screen.queryByRole('button', { name: 'Save steps' })).toBeNull()
})
