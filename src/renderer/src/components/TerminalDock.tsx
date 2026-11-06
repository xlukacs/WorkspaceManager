import { visibleConsoleSessions } from '@shared/navigation'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { Clipboard, Maximize2, Minimize2, OctagonX, Pencil, Pin, Play, Search, Square, Trash2, X } from 'lucide-react'
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

function consoleTabIdentity(session: TerminalSession) {
  return [
    session.id,
    session.workspaceId,
    session.title,
    session.status,
    session.pinned,
    session.worktreePath ?? '',
    session.exitCode ?? '',
    session.cwd,
    session.shellLine
  ].join('\u0001')
}

function isXtermFocusTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('.xterm'))
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
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameCancelledRef = useRef(false)
  const consoleTabFilter = useAppStore((state) => state.consoleTabFilter)
  const toggleConsoleTabFilter = useAppStore((state) => state.toggleConsoleTabFilter)
  const selectedWorktreePath = useAppStore((state) => state.selectedWorktreeByWorkspace[workspace.id])
  const consoleTabKey = useAppStore((state) =>
    visibleConsoleSessions(state.terminals, workspace, consoleTabFilter, selectedWorktreePath)
      .map(consoleTabIdentity)
      .join('\n')
  )
  const terminals = useMemo(
    () => visibleConsoleSessions(useAppStore.getState().terminals, workspace, consoleTabFilter, selectedWorktreePath),
    [consoleTabKey, workspace, consoleTabFilter, selectedWorktreePath]
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
  const contextSession = contextMenu
    ? terminals.find((session) => session.id === contextMenu.sessionId) ?? null
    : null

  function startRename(session: TerminalSession) {
    renameCancelledRef.current = false
    setContextMenu(null)
    setActiveTerminal(session.id)
    setEditingSessionId(session.id)
    terminalRef.current?.blur()
  }

  function cancelRename() {
    renameCancelledRef.current = true
    setEditingSessionId(null)
  }

  async function commitRename(session: TerminalSession) {
    if (renameCancelledRef.current) return
    renameCancelledRef.current = true
    const nextTitle = renameInputRef.current?.value.trim() ?? ''
    setEditingSessionId(null)
    if (!nextTitle || nextTitle === session.title) return
    await renameTerminal(session.id, nextTitle)
  }

  useLayoutEffect(() => {
    if (!editingSessionId) {
      delete document.body.dataset.renamingConsole
      return
    }

    document.body.dataset.renamingConsole = 'true'
    terminalRef.current?.blur()
    renameInputRef.current?.focus({ preventScroll: true })
    renameInputRef.current?.select()
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement === renameInputRef.current) return
      terminalRef.current?.blur()
      renameInputRef.current?.focus({ preventScroll: true })
      renameInputRef.current?.select()
    })

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && renameInputRef.current?.contains(target)) return
      const session = useAppStore.getState().terminals.find((item) => item.id === editingSessionId)
      if (session) void commitRename(session)
    }

    function onFocusIn(event: FocusEvent) {
      if (!isXtermFocusTarget(event.target)) return
      event.stopPropagation()
      terminalRef.current?.blur()
      renameInputRef.current?.focus({ preventScroll: true })
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
    document.addEventListener('focusin', onFocusIn, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      window.removeEventListener('keydown', onKeyDown, true)
      delete document.body.dataset.renamingConsole
    }
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
        icon: <Pin {...menuIconProps} fill={session.pinned ? 'currentColor' : 'none'} />,
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
  const activeSessionId = activeSession?.id ?? null

  // The tab strip hides its scrollbar, so turn vertical wheel motion into sideways scrolling.
  useEffect(() => {
    const strip = tabsRef.current
    if (!strip) return
    function onWheel(event: WheelEvent) {
      if (!strip || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      if (strip.scrollWidth <= strip.clientWidth) return
      event.preventDefault()
      strip.scrollLeft += event.deltaY
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [])

  // Keep the active tab visible when hotkeys or new consoles change it.
  // Scroll only the strip; scrollIntoView would also scroll the page to the dock.
  useEffect(() => {
    const strip = tabsRef.current
    const tab = strip?.querySelector<HTMLElement>('.terminal-tab-shell.active')
    if (!strip || !tab) return
    const bounds = strip.getBoundingClientRect()
    const target = tab.getBoundingClientRect()
    if (target.left < bounds.left) strip.scrollLeft -= bounds.left - target.left
    else if (target.right > bounds.right) strip.scrollLeft += target.right - bounds.right
  }, [activeSessionId])
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
          <button
            type="button"
            role="switch"
            className={`terminal-dock-head-button terminal-worktree-switch${consoleTabFilter === 'all' ? ' is-on' : ''}`}
            aria-label="Show consoles from all worktrees"
            aria-checked={consoleTabFilter === 'all'}
            title={consoleTabFilter === 'all' ? 'Showing consoles from all worktrees' : 'Showing consoles from this worktree'}
            onClick={toggleConsoleTabFilter}
          >
            <span>All worktrees</span>
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
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

      <div className="terminal-tabs" ref={tabsRef}>
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
                    key={session.id}
                    ref={renameInputRef}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Rename ${session.title}`}
                    defaultValue={session.title}
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
                <Pin {...dockIconProps} fill={session.pinned ? 'currentColor' : 'none'} />
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
                <X {...dockIconProps} />
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
                <Trash2 className="toolbar-glyph" {...dockIconProps} />
              </button>
              {activeSessionRunning ? (
                <button
                  type="button"
                  className="danger icon-button terminal-toolbar-icon"
                  aria-label="Stop console"
                  title="Stop console"
                  onClick={() => stopTerminal(activeSession.id)}
                >
                  <Square className="toolbar-glyph" fill="currentColor" {...dockIconProps} />
                </button>
              ) : (
                <button
                  type="button"
                  className="solid icon-button terminal-toolbar-icon"
                  aria-label="Restart console"
                  title="Restart console"
                  onClick={() => restartTerminal(activeSession.id)}
                >
                  <Play className="toolbar-glyph" fill="currentColor" {...dockIconProps} />
                </button>
              )}
            </div>
          </div>
          <div className="terminal-frame">
            <XTerminal ref={terminalRef} sessionId={activeSession.id} suspendInput={Boolean(editingSessionId)} />
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
