// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { useAppStore } from './store/useAppStore'

vi.mock('@renderer/components/WorkspacePanel', () => ({ WorkspacePanel: () => null }))

const initialState = useAppStore.getState()
afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
  delete (window as { workspaceApi?: unknown }).workspaceApi
})

it('shows dropped group memberships and persists dismissal of the migration banner', async () => {
  const clearMigrationNotes = vi.fn(async () => undefined)
  Object.defineProperty(window, 'workspaceApi', {
    configurable: true,
    value: {
      terminals: { subscribeOutput: () => () => {}, subscribeExit: () => () => {} },
      workspaces: { subscribeUpdated: () => () => {}, subscribeScanError: () => () => {} },
      system: { clearMigrationNotes }
    }
  })
  useAppStore.setState({
    bootstrapped: true, bootstrap: async () => {},
    migrationNotes: ["API was also in 'Backend'; kept 'Frontend'"]
  })
  render(<App />)
  expect(screen.getByRole('status', { name: 'Workspace group updates' }).textContent).toContain("kept 'Frontend'")
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Workspace group updates' })).toBeNull())
  expect(clearMigrationNotes).toHaveBeenCalledOnce()
  expect(useAppStore.getState().migrationNotes).toEqual([])
})

it.each(['error', 'unhandledrejection'])('recovers from window %s with Retry and offers Reload', async (kind) => {
  Object.defineProperty(window, 'workspaceApi', { configurable: true, value: {
    terminals: { subscribeOutput: () => () => {}, subscribeExit: () => () => {} },
    workspaces: { subscribeUpdated: () => () => {}, subscribeScanError: () => () => {} }, system: {}
  } })
  useAppStore.setState({ bootstrapped: true, bootstrap: async () => {} })
  render(<App />)
  const event = kind === 'error' ? new ErrorEvent('error', { error: new Error('Probe failure'), cancelable: true }) : new Event('unhandledrejection', { cancelable: true })
  if (kind === 'unhandledrejection') Object.defineProperty(event, 'reason', { value: new Error('Probe failure') })
  act(() => { window.dispatchEvent(event) })
  expect(screen.getByRole('alert').textContent).toBe('Probe failure')
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
