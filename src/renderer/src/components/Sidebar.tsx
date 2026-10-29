import React, { Fragment, useMemo, type MouseEvent } from 'react'
import { FolderPlus, PanelLeftClose, PanelLeftOpen, Pause, Play, Settings } from 'lucide-react'
import { AppLogo } from '@renderer/components/AppLogo'
import { SidebarTree } from '@renderer/components/SidebarTree'
import { useAppStore, useVisibleWorkspaces } from '@renderer/store/useAppStore'

function workspaceMonogram(name: string) {
  const parts = name.split(/[\s_-]+/).filter(Boolean)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function beginSidebarAction(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export function Sidebar() {
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const groups = useAppStore((state) => state.groups)
  const selectedWorkspaceId = useAppStore((state) => state.selectedWorkspaceId)
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const setSelectedWorkspace = useAppStore((state) => state.setSelectedWorkspace)
  const importWorkspaces = useAppStore((state) => state.importWorkspaces)
  const toggleWorkspacePause = useAppStore((state) => state.toggleWorkspacePause)
  const runningConsoleKey = useAppStore((state) =>
    state.terminals
      .filter((session) => session.status === 'running')
      .map((session) => session.workspaceId)
      .sort()
      .join(',')
  )
  const pausedConsoleKey = useAppStore((state) =>
    state.terminals
      .filter((session) => session.workspacePaused)
      .map((session) => session.workspaceId)
      .sort()
      .join(',')
  )
  const workspaces = useVisibleWorkspaces()
  const groupColors = useMemo(() => new Map(groups.map((group) => [group.id, group.color])), [groups])
  const runningConsoleWorkspaceIds = useMemo(
    () => new Set(runningConsoleKey.split(',').filter(Boolean)),
    [runningConsoleKey]
  )
  const pausedConsoleWorkspaceIds = useMemo(
    () => new Set(pausedConsoleKey.split(',').filter(Boolean)),
    [pausedConsoleKey]
  )

  const isWorkspacePaused = (workspaceId: string) =>
    pausedConsoleWorkspaceIds.has(workspaceId) && !runningConsoleWorkspaceIds.has(workspaceId)

  function renderWorkspacePauseButton(workspaceId: string, workspaceName: string) {
    const hasRunning = runningConsoleWorkspaceIds.has(workspaceId)
    const isPaused = isWorkspacePaused(workspaceId)
    if (!isPaused && !hasRunning) return null
    const label = isPaused ? 'Resume workspace consoles' : 'Pause workspace consoles'

    return (
      <button
        type="button"
        className={`project-pause-button compact${isPaused ? ' is-paused' : ''}`}
        title={`${label}: ${workspaceName}`}
        aria-label={`${label}: ${workspaceName}`}
        onClick={(event) => {
          beginSidebarAction(event)
          void toggleWorkspacePause(workspaceId)
        }}
      >
        {isPaused
          ? <Play size={12} strokeWidth={2} aria-hidden="true" />
          : <Pause size={12} strokeWidth={2} aria-hidden="true" />}
      </button>
    )
  }

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {sidebarCollapsed ? (
        <div className="sidebar-collapsed-stack">
          <div className="sidebar-collapsed-top">
            <div className="sidebar-wordmark-rail">
              <AppLogo className="sidebar-collapsed-logo" />
            </div>
            <button
              type="button"
              className="sidebar-toggle-button"
              title="Expand sidebar"
              aria-label="Expand sidebar"
              onClick={toggleSidebar}
            >
              <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <div className="collapsed-projects">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="collapsed-project-shell">
                <button
                  type="button"
                  className={`project-avatar ${selectedWorkspaceId === workspace.id ? 'active' : ''}${runningConsoleWorkspaceIds.has(workspace.id) ? ' has-running-console' : ''}${isWorkspacePaused(workspace.id) ? ' is-paused' : ''}`}
                  onClick={() => setSelectedWorkspace(workspace.id)}
                  title={
                    isWorkspacePaused(workspace.id)
                      ? `${workspace.name} — consoles paused`
                      : runningConsoleWorkspaceIds.has(workspace.id)
                        ? `${workspace.name} — console running`
                        : workspace.name
                  }
                  aria-label={workspace.name}
                  style={workspace.groupId && groupColors.get(workspace.groupId)
                    ? { boxShadow: `inset 3px 0 0 ${groupColors.get(workspace.groupId)}` }
                    : undefined}
                >
                  {workspaceMonogram(workspace.name)}
                </button>
                {renderWorkspacePauseButton(workspace.id, workspace.name)}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mini-action mini-action-icon"
            onClick={() => importWorkspaces('folders')}
            title="Add folders"
            aria-label="Add folders"
          >
            <FolderPlus size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <Fragment>
          <div className="sidebar-header compact">
            <p className="sidebar-wordmark" title="Workspace Manager">
              <AppLogo withTitle className="sidebar-wordmark-logo" />
            </p>
            <button
              type="button"
              className="sidebar-toggle-button"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              onClick={toggleSidebar}
            >
              <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="sidebar-sections">
            <SidebarTree />
          </div>

          <div className="sidebar-footer">
            <button
              type="button"
              className="mini-action mini-action-icon sidebar-import-action"
              onClick={() => importWorkspaces('folders')}
              title="Add folders"
              aria-label="Add folders"
            >
              <FolderPlus size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </Fragment>
      )}
      <button type="button" className="sidebar-settings-button" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        <Settings size={18} aria-hidden="true" />{!sidebarCollapsed && <span>Settings</span>}
      </button>
    </aside>
  )
}
