import { SettingsDialog } from '@renderer/components/SettingsDialog'
import React, { Component, type ReactNode, useEffect, useState } from 'react'
import { AppLogo } from '@renderer/components/AppLogo'
import { Sidebar } from '@renderer/components/Sidebar'
import { WorkspacePanel } from '@renderer/components/WorkspacePanel'
import { ImportDrawer } from '@renderer/components/ImportDrawer'
import { useWorkspaceHotkeys } from '@renderer/hooks/useWorkspaceHotkeys'
import { useAppStore, useSelectedWorkspace } from '@renderer/store/useAppStore'

class RendererErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  private readonly onWindowError = (event: ErrorEvent) => {
    event.preventDefault()
    this.setState({ error: event.error instanceof Error ? event.error : new Error(event.message || 'Unexpected error.') })
  }
  private readonly onUnhandledRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault()
    this.setState({ error: event.reason instanceof Error ? event.reason : new Error(String(event.reason)) })
  }
  componentDidMount() {
    window.addEventListener('error', this.onWindowError)
    window.addEventListener('unhandledrejection', this.onUnhandledRejection)
  }
  componentWillUnmount() {
    window.removeEventListener('error', this.onWindowError)
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="boot">
          <div className="boot-mark">
            <AppLogo />
          </div>
          <h1>Renderer crashed.</h1>
          <p className="muted" role="alert">{this.state.error.message}</p>
          <div className="settings-file-actions">
            <button type="button" onClick={() => this.setState({ error: null })}>Retry</button>
            <button type="button" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export function App() { return <RendererErrorBoundary><AppContent /></RendererErrorBoundary> }

function AppContent() {
  const [bootError, setBootError] = useState<Error | null>(null)
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const bootstrapped = useAppStore((state) => state.bootstrapped)
  const handleTerminalOutput = useAppStore((state) => state.handleTerminalOutput)
  const handleTerminalExit = useAppStore((state) => state.handleTerminalExit)
  const migrationNotes = useAppStore((state) => state.migrationNotes)
  const dismissMigrationNotes = useAppStore((state) => state.dismissMigrationNotes)
  const handleWorkspaceUpdate = useAppStore((state) => state.handleWorkspaceUpdate)
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
  const selectedWorkspace = useSelectedWorkspace()
  const hasBridge = typeof window.workspaceApi !== 'undefined'

  useWorkspaceHotkeys()

  useEffect(() => {
    if (!hasBridge) return
    void bootstrap().catch((error) => {
      setBootError(error instanceof Error ? error : new Error(String(error)))
    })
  }, [bootstrap, hasBridge])

  useEffect(() => {
    if (!hasBridge) return
    const unsubscribeAppChanged = window.workspaceApi.system.subscribeAppChanged?.(({ sessionId }) => {
      void bootstrap().then(() => { if (sessionId) useAppStore.getState().setActiveTerminal(sessionId) }).catch((error) => useAppStore.setState({ lastActionError: String(error) }))
    })
    const unsubscribeOutput = window.workspaceApi.terminals.subscribeOutput(handleTerminalOutput)
    const unsubscribeExit = window.workspaceApi.terminals.subscribeExit(handleTerminalExit)
    const unsubscribeWorkspace = window.workspaceApi.workspaces.subscribeUpdated((workspace) => { void handleWorkspaceUpdate(workspace) })
    const unsubscribeScanError = window.workspaceApi.workspaces.subscribeScanError((message) => useAppStore.setState({ lastActionError: message }))
    return () => {
      unsubscribeAppChanged?.()
      unsubscribeOutput()
      unsubscribeExit()
      unsubscribeWorkspace()
      unsubscribeScanError()
    }
  }, [bootstrap, handleTerminalExit, handleTerminalOutput, handleWorkspaceUpdate, hasBridge])

  if (bootError) throw bootError

  if (!hasBridge) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <AppLogo />
        </div>
        <h1>Renderer bridge unavailable.</h1>
        <p className="muted">
          The Electron preload script did not load, so the workspace UI cannot talk to the main process.
        </p>
      </div>
    )
  }

  if (!bootstrapped) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <AppLogo />
        </div>
        <h1>Loading your workspace deck…</h1>
      </div>
    )
  }

  return (
      <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="backdrop-lines" />
        <Sidebar />
        {migrationNotes.length > 0 && (
          <aside className="migration-banner" role="status" aria-label="Workspace group updates">
            {migrationNotes.map((note, index) => <p key={index}>{note}</p>)}
            <button type="button" onClick={() => { void dismissMigrationNotes() }}>Dismiss</button>
          </aside>
        )}
        {selectedWorkspace ? (
          <WorkspacePanel workspace={selectedWorkspace} />
        ) : (
          <main className="workspace-shell empty-panel">
            <p className="eyebrow">No workspace selected</p>
            <h2>Import a workspace to start a console deck.</h2>
            <p>
              Pull in a folder directly or scan a parent directory. Scripts, git state, and terminal tabs will
              populate once a workspace is added.
            </p>
          </main>
        )}
        <ImportDrawer />
        {settingsOpen && <SettingsDialog />}
      </div>
  )
}
