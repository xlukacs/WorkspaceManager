import { visibleConsoleSessions } from '@shared/navigation'
import React, { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { Clipboard, Maximize2, Minimize2, OctagonX, Pencil, Search, Star, Trash2 } from 'lucide-react'
import type { WorkspaceRecord, TerminalSession } from '@shared/types'
import {
  listWorkspaceWorktrees,
  normalizeComparePath,
  worktreeLabel
} from '@shared/worktreeExecution'
import { ContextMenuPopover, type ContextMenuItem } from '@renderer/components/ContextMenuPopover'
import { XTerminal, type XTerminalHandle } from '@renderer/components/XTerminal'
import { useAppStore } from '@renderer/store/useAppStore'

const dockIconProps = { size: 15, strokeWidth: 1.75, 'aria-hidden': true as const }
const menuIconProps = { size: 15, strokeWidth: 1.75, 'aria-hidden': true as const }

function PinIcon() {
  return (
    <svg className="pin-glyph" aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 0 0 .95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 0 0-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 0 0-1.176 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 0 0-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81H7.03a1 1 0 0 0 .951-.69l1.07-3.292Z"
        fill="currentColor"
      />
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M4 4l8 8M12 4 4 12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg className="toolbar-glyph play-glyph" aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M6.3 4.86c0-1.04 1.14-1.67 2.02-1.1l7.62 4.89c.81.52.81 1.7 0 2.22l-7.62 4.89c-.88.57-2.02-.06-2.02-1.1V4.86Z"
        fill="currentColor"
      />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="toolbar-glyph" aria-hidden="true" viewBox="0 0 16 16">
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.35" fill="currentColor" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg className="toolbar-glyph" aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M6.5 2.75a.75.75 0 0 1 .73-.6h1.54a.75.75 0 0 1 .73.6l.12.6h2.13a.75.75 0 0 1 0 1.5h-.33l-.47 7.14a1.5 1.5 0 0 1-1.5 1.4H6.55a1.5 1.5 0 0 1-1.5-1.4l-.47-7.14h-.33a.75.75 0 0 1 0-1.5h2.13l.12-.6Zm1.5 2.8a.6.6 0 0 0-.6.6v4.3a.6.6 0 1 0 1.2 0v-4.3a.6.6 0 0 0-.6-.6Zm-1.95.6a.6.6 0 1 1 1.2 0v4.3a.6.6 0 0 1-1.2 0v-4.3Zm4.75-.6a.6.6 0 0 0-.6.6v4.3a.6.6 0 1 0 1.2 0v-4.3a.6.6 0 0 0-.6-.6Z"
        fill="currentColor"
      />
    </svg>
  )
}

const CONSOLE_STATUS_META: Record<TerminalSession['status'], { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'running' },
  stopped: { label: 'Stopped', tone: 'stopped' },
  exited: { label: 'Exited', tone: 'exited' },
  failed: { label: 'Failed', tone: 'failed' }
}

function sessionWorktreeLabel(workspace: WorkspaceRecord, session: TerminalSession) {
  const checkoutPath = session.worktreePath ?? workspace.rootPath
  const worktree = listWorkspaceWorktrees(workspace).find(
    (entry) => normalizeComparePath(entry.path) === normalizeComparePath(checkoutPath)
  )
  return worktree ? worktreeLabel(worktree) : null
}

function ConsoleStatusBadge({ session }: { session: TerminalSession }) {
  const meta = CONSOLE_STATUS_META[session.status]
  const exitDetail = session.exitCode !== null && session.status !== 'running' && session.status !== 'stopped'
    ? `Exit code ${session.exitCode}`
    : null

  return (
    <span
      className={`console-status-badge ${meta.tone}`}
      title={exitDetail ?? undefined}
      aria-label={exitDetail ? `${meta.label}, ${exitDetail}` : meta.label}
    >
      <span className="console-status-dot" aria-hidden="true" />
      {meta.label}
    </span>
  )
}

export function TerminalDock({ workspace }: { workspace: WorkspaceRecord }) {
  const terminalRef = useRef<XTerminalHandle | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameCancelledRef = useRef(false)
  const editingTitleRef = useRef('')
  const allTerminals = useAppStore((state) => state.terminals)
  const consoleTabFilter = useAppStore((state) => state.consoleTabFilter)
  const toggleConsoleTabFilter = useAppStore((state) => state.toggleConsoleTabFilter)
  const selectedWorktreePath = useAppStore((state) => state.selectedWorktreeByWorkspace[workspace.id])
  const terminals = useMemo(
    () => visibleConsoleSessions(allTerminals, workspace, consoleTabFilter, selectedWorktreePath),
    [allTerminals, workspace, consoleTabFilter, selectedWorktreePath]
  )
  const workspaceRunningCount = useAppStore(
    (state) => state.terminals.reduce((count, session) => count + (session.status === 'running' ? 1 : 0), 0)
  )
  const activeTerminalId = useAppStore((state) => state.activeTerminalId)
  const commandList = useAppStore((state) => state.commandLists[workspace.id])
  const lastActionError = useAppStore((state) => state.lastActionError)
  const clearActionError = useAppStore((state) => state.clearActionError)
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal)
  const stopTerminal = useAppStore((state) => state.stopTerminal)
  const restartTerminal = useAppStore((state) => state.restartTerminal)
  const clearTerminal = useAppStore((state) => state.clearTerminal)
  const removeTerminal = useAppStore((state) => state.removeTerminal)
  const renameTerminal = useAppStore((state) => state.renameTerminal)
  const togglePinTerminal = useAppStore((state) => state.togglePinTerminal)
  const stopAllTerminals = useAppStore((state) => state.stopAllTerminals)
  const consoleFullscreen = useAppStore((state) => state.consoleFullscreen)
  const toggleConsoleFullscreen = useAppStore((state) => state.toggleConsoleFullscreen)
  const runCommand = useAppStore((state) => state.runCommand)
  const showWorktreeLabels = consoleTabFilter === 'all'
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  editingTitleRef.current = editingTitle
  const contextSession = contextMenu
    ? terminals.find((session) => session.id === contextMenu.sessionId) ?? null
    : null

  function startRename(session: TerminalSession) {
    renameCancelledRef.current = false
    setContextMenu(null)
    setActiveTerminal(session.id)
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
    editingTitleRef.current = session.title
    terminalRef.current?.blur()
  }

  function cancelRename() {
    renameCancelledRef.current = true
    setEditingSessionId(null)
    setEditingTitle('')
  }

  async function commitRename(session: TerminalSession) {
    if (renameCancelledRef.current) return
    renameCancelledRef.current = true
    const nextTitle = editingTitleRef.current.trim()
    setEditingSessionId(null)
    setEditingTitle('')
    if (!nextTitle || nextTitle === session.title) return
    await renameTerminal(session.id, nextTitle)
  }

  useEffect(() => {
    if (!editingSessionId) {
      delete document.body.dataset.renamingConsole
      return
    }

    document.body.dataset.renamingConsole = 'true'
    terminalRef.current?.blur()
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus({ preventScroll: true })
      renameInputRef.current?.select()
    })

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && renameInputRef.current?.contains(target)) return
      const session = useAppStore.getState().terminals.find((item) => item.id === editingSessionId)
      if (session) void commitRename(session)
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelRename()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const session = useAppStore.getState().terminals.find((item) => item.id === editingSessionId)
        if (session) void commitRename(session)
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      delete document.body.dataset.renamingConsole
    }
    // Focus and listeners must not reset when terminal output updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSessionId])

  function handleTabContextMenu(event: MouseEvent<HTMLElement>, session: TerminalSession) {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX || rect.left + 12
    const y = event.clientY || rect.bottom - 8
    setActiveTerminal(session.id)
    setContextMenu({ sessionId: session.id, x, y })
  }

  function tabContextMenuItems(session: TerminalSession): ContextMenuItem[] {
    return [
      {
        id: 'rename',
        label: 'Rename',
        icon: <Pencil {...menuIconProps} />,
        onSelect: () => startRename(session)
      },
      {
        id: 'pin',
        label: session.pinned ? 'Unpin' : 'Pin',
        icon: <Star {...menuIconProps} />,
        onSelect: () => {
          setActiveTerminal(session.id)
          void togglePinTerminal(session.id)
        }
      },
      {
        id: 'remove',
        label: 'Remove',
        icon: <Trash2 {...menuIconProps} />,
        danger: true,
        onSelect: () => {
          if (!window.confirm(`Remove console "${session.title}" from the deck?`)) return
          void removeTerminal(session.id)
        }
      }
    ]
  }

  const activeSession = terminals.find((session) => session.id === activeTerminalId) ?? terminals[0] ?? null
  const activeSessionRunning = activeSession?.status === 'running'
  const pinnedCount = terminals.filter((session) => session.pinned).length
  const quickLaunch = commandList
    ? [...commandList.favorites, ...commandList.groups.flatMap((group) => group.commands)]
        .filter((command, index, commands) => commands.findIndex((item) => item.id === command.id) === index)
        .slice(0, 6)
    : []

  return (
    <section className={`terminal-dock ${consoleFullscreen ? 'terminal-dock-fullscreen' : ''}`}>
      <div className="section-head terminal-dock-head">
        <div>
          <h2>Console Deck</h2>
          <span>{terminals.length} tabs{pinnedCount > 0 ? `, ${pinnedCount} pinned` : ''}</span>
        </div>
        <div className="terminal-dock-head-actions">
          <button type="button" className="terminal-dock-head-button"
            aria-label="Show consoles from this worktree only" aria-pressed={consoleTabFilter === 'worktree'}
            onClick={toggleConsoleTabFilter}>
            {consoleTabFilter === 'all' ? 'All worktrees' : 'This worktree'}
          </button>
          <button
            type="button"
            className="terminal-dock-head-button"
            title="Toggle console fullscreen (F)"
            aria-label={consoleFullscreen ? 'Exit console fullscreen' : 'Enter console fullscreen'}
            onClick={toggleConsoleFullscreen}
          >
            {consoleFullscreen ? <Minimize2 {...dockIconProps} /> : <Maximize2 {...dockIconProps} />}
            <span>{consoleFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
          </button>
          <button
            type="button"
            className="terminal-dock-head-button danger"
            title="Stop every running console in the workspace"
            disabled={workspaceRunningCount === 0}
            onClick={() => {
              if (
                !window.confirm(
                  `Stop all ${workspaceRunningCount} running console${workspaceRunningCount === 1 ? '' : 's'} across the workspace?`
                )
              ) {
                return
              }
              void stopAllTerminals()
            }}
          >
            <OctagonX {...dockIconProps} />
            <span>Kill all</span>
          </button>
        </div>
      </div>

      <div className="terminal-tabs">
        {terminals.map((session) => {
          const branchLabel = sessionWorktreeLabel(workspace, session)
          const renaming = editingSessionId === session.id
          const tabMeta = (
            <div className="terminal-tab-meta">
              <ConsoleStatusBadge session={session} />
              {branchLabel && showWorktreeLabels && (
                <span className="terminal-tab-worktree" title={session.worktreePath ?? workspace.rootPath}>
                  {branchLabel}
                </span>
              )}
            </div>
          )
          return (
          <div
            key={session.id}
            className={`terminal-tab-shell ${activeSession?.id === session.id ? 'active' : ''}`}
            onContextMenu={(event) => {
              if (editingSessionId === session.id) return
              handleTabContextMenu(event, session)
            }}
          >
            {renaming ? (
              <div className={`terminal-tab ${activeSession?.id === session.id ? 'active' : ''}`}>
                {tabMeta}
                <form
                  className="terminal-tab-rename"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    void commitRename(session)
                  }}
                >
                  <input
                    ref={renameInputRef}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Rename ${session.title}`}
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                      event.stopPropagation()
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRename()
                      }
                    }}
                  />
                </form>
              </div>
            ) : (
              <button
                type="button"
                className={`terminal-tab ${activeSession?.id === session.id ? 'active' : ''}`}
                aria-label={`${session.title} console`}
                onClick={() => setActiveTerminal(session.id)}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  startRename(session)
                }}
              >
                {tabMeta}
                <strong>{session.title}</strong>
              </button>
            )}
            {!renaming && (
            <div className="terminal-tab-actions">
              <button
                type="button"
                className={`terminal-tab-action ${session.pinned ? 'active' : ''}`}
                aria-label={session.pinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
                title={session.pinned ? 'Unpin console' : 'Pin console'}
                onClick={() => {
                  setActiveTerminal(session.id)
                  void togglePinTerminal(session.id)
                }}
              >
                <PinIcon />
              </button>
              <button
                type="button"
                className="terminal-tab-action danger"
                aria-label={`Remove ${session.title}`}
                title="Remove console"
                onClick={() => {
                  if (!window.confirm(`Remove console "${session.title}" from the deck?`)) return
                  void removeTerminal(session.id)
                }}
              >
                <RemoveIcon />
              </button>
            </div>
            )}
          </div>
          )
        })}
      </div>
      <ContextMenuPopover
        open={Boolean(contextSession)}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        label="Console actions"
        items={contextSession ? tabContextMenuItems(contextSession) : []}
        onClose={() => setContextMenu(null)}
      />

      {lastActionError && (
        <div className="terminal-error-banner">
          <span>{lastActionError}</span>
          <button type="button" onClick={clearActionError}>
            Dismiss
          </button>
        </div>
      )}

      {activeSession ? (
        <>
          <div className="terminal-toolbar">
            <div className="terminal-toolbar-copy">
              <strong>{activeSession.shellLine}</strong>
              <span>{activeSession.cwd}</span>
            </div>
            <div className="command-actions terminal-toolbar-actions">
              <button
                type="button"
                className="icon-button terminal-toolbar-icon"
                aria-label="Search console output"
                title="Search console output (Ctrl+F)"
                onClick={() => terminalRef.current?.openSearch()}
              >
                <Search className="toolbar-glyph" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button terminal-toolbar-icon"
                aria-label="Copy selected text or console output"
                title="Copy selected text, or all console output"
                onClick={() => terminalRef.current?.copy()}
              >
                <Clipboard className="toolbar-glyph" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => startRename(activeSession)}
              >
                Rename
              </button>
              <button
                type="button"
                className="icon-button terminal-toolbar-icon"
                aria-label="Clear console"
                title="Clear console"
                onClick={() => clearTerminal(activeSession.id)}
              >
                <ClearIcon />
              </button>
              {activeSessionRunning ? (
                <button
                  type="button"
                  className="danger icon-button terminal-toolbar-icon"
                  aria-label="Stop console"
                  title="Stop console"
                  onClick={() => stopTerminal(activeSession.id)}
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className="solid icon-button terminal-toolbar-icon"
                  aria-label="Restart console"
                  title="Restart console"
                  onClick={() => restartTerminal(activeSession.id)}
                >
                  <PlayIcon />
                </button>
              )}
            </div>
          </div>
          <div className="terminal-frame">
            <XTerminal ref={terminalRef} session={activeSession} />
          </div>
        </>
      ) : (
        <div className="terminal-empty">
          <strong>{consoleTabFilter === 'worktree' ? 'No consoles in this worktree.' : 'No console running.'}</strong>
          <p>{consoleTabFilter === 'worktree' ? 'Launch a command here or switch to All worktrees.' : 'Launch a dev script and its output will stay centered here.'}</p>
          {quickLaunch.length > 0 && (
            <div className="launch-strip">
              {quickLaunch.map((command) => (
                <button key={command.id} type="button" onClick={() => runCommand(command.id)}>
                  {command.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
