// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'
import { useAppStore } from '@renderer/store/useAppStore'
import { normalizeSettings } from '@shared/settings'
const initial = useAppStore.getState()
afterEach(() => { cleanup(); useAppStore.setState(initial, true); delete (window as { workspaceApi?: unknown }).workspaceApi })
it('saves preferences, selects a certificate, and presents the shortcuts reference', async () => {
  const update = vi.fn(async (patch) => normalizeSettings({ ...useAppStore.getState().settings, ...patch }))
  Object.defineProperty(window, 'workspaceApi', { configurable: true, value: { settings: { update, platform: async () => 'linux', pickNodeCaCertificate: async () => '/tmp/CA.pem' } } })
  render(<SettingsDialog />)
  fireEvent.change(screen.getByLabelText('Default Open target'), { target: { value: 'folder' } })
  await waitFor(() => expect(useAppStore.getState().settings.defaultOpenTarget).toBe('folder'))
  fireEvent.change(screen.getByLabelText('External terminal'), { target: { value: 'kitty' } })
  await waitFor(() => expect(useAppStore.getState().settings.preferredExternalTerminal).toBe('kitty'))
  fireEvent.click(screen.getByRole('button', { name: 'Choose certificate…' }))
  await waitFor(() => expect(useAppStore.getState().settings.nodeCaCertificate).toBe('/tmp/CA.pem'))
  fireEvent.click(screen.getByRole('button', { name: 'Clear certificate' }))
  await waitFor(() => expect(useAppStore.getState().settings.nodeCaCertificate).toBeNull())
  expect(screen.getByText('Ctrl+1–9')).toBeTruthy()
  expect(screen.getByText('Restart active console')).toBeTruthy()
})
