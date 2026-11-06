import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Folder,
  FolderOpen,
  GitBranch,
  Pin,
  Play,
  RefreshCw,
  SlidersHorizontal,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'
import type { EditorTarget, OpenTarget, PinnedEndpoint, WorkspaceRecord, RunAction } from '@shared/types'
import { selectWorktreesForCleanup } from '@shared/worktreeCleanup'
import { WorktreeCheckoutBar } from '@renderer/components/WorktreeCheckoutBar'
import { readWorktreeCleanupSettings } from '@renderer/components/WorktreeCleanupPanel'
import { WorktreesDialog } from '@renderer/components/WorktreesDialog'
import { CommandPanel } from '@renderer/components/CommandPanel'
import { DockerPanel } from '@renderer/components/DockerPanel'
import { TerminalDock } from '@renderer/components/TerminalDock'
import { useAppStore } from '@renderer/store/useAppStore'

const iconProps = { strokeWidth: 1.75, 'aria-hidden': true as const }

function CursorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M2.2 2.1 13.7 7.8 8.9 9.2l-1.4 4.7L2.2 2.1Z" fill="currentColor" />
    </svg>
  )
}

function VsCodeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m10.3 2.1 3 1.5v8.8l-3 1.5-5.6-4.3-2.2 1.7L1 10.2V5.8l1.5-1.1 2.2 1.7 5.6-4.3Zm-.4 2.1L6.8 6.6l2.1 1.4-2.1 1.4 3.1 2.4 1.7-.8V5l-1.7-.8Z" fill="currentColor" />
    </svg>
  )
}

function OpenTargetIcon({ target }: { target: OpenTarget }) {
  if (target === 'cursor') return <CursorIcon />
  if (target === 'vscode') return <VsCodeIcon />
  if (target === 'terminal') return <SquareTerminal {...iconProps} />
  return <FolderOpen {...iconProps} />
}

interface WorkspaceEndpoint {
  key: string
  label: string
  url: string
  port: number
}

function extractWorkspaceEndpoints(rawSources: string[]) {
  const endpointMap = new Map<string, WorkspaceEndpoint>()
  const urlPattern = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d+))?(?:\/[^\s"'`)]*)?/gi
  const hostPortPattern = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)\b/gi
  const dockerPortPattern = /(?:^|\s)-p\s+(\d+):(\d+)\b/gi
  const ansiPattern = /\u001B\[[0-9;]*[A-Za-z]/g

  function registerEndpoint(url: string, port: number) {
    let normalizedUrl = url
      .replace('127.0.0.1', 'localhost')
      .replace('0.0.0.0', 'localhost')
      .replace('[::1]', 'localhost')

    try {
      const parsed = new URL(normalizedUrl)
      if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
        parsed.pathname = ''
      }
      normalizedUrl = parsed.toString()
    } catch {
      normalizedUrl = normalizedUrl.replace(/\/$/, '')
    }

    const key = `${port}:${normalizedUrl}`
    if (endpointMap.has(key)) return
    endpointMap.set(key, {
      key,
      label: normalizedUrl.replace(/^https?:\/\//, ''),
      url: normalizedUrl,
      port
    })
  }

  for (const source of rawSources) {
    const cleanSource = source.replace(ansiPattern, '')
    let match: RegExpExecArray | null

    urlPattern.lastIndex = 0
    while ((match = urlPattern.exec(cleanSource)) !== null) {
      const port = Number(match[1] ?? 80)
      registerEndpoint(match[0], port)
    }

    hostPortPattern.lastIndex = 0
    while ((match = hostPortPattern.exec(cleanSource)) !== null) {
      const port = Number(match[1])
      registerEndpoint(`http://localhost:${port}`, port)
    }

    dockerPortPattern.lastIndex = 0
    while ((match = dockerPortPattern.exec(cleanSource)) !== null) {
      const hostPort = Number(match[1])
      registerEndpoint(`http://localhost:${hostPort}`, hostPort)
    }
  }

  return [...endpointMap.values()].sort((left, right) => left.port - right.port || left.label.localeCompare(right.label))
}

function useRunningWorkspaceEndpoints(workspaceId: string) {
  const runningKey = useAppStore((state) =>
    state.terminals
      .filter((session) => session.workspaceId === workspaceId && session.status === 'running')
      .map((session) => session.id)
      .join(',')
  )
  const [endpoints, setEndpoints] = useState<WorkspaceEndpoint[]>([])

  useEffect(() => {
    if (!runningKey) {
      setEndpoints([])
      return
    }

    const scan = () => {
      const sources = useAppStore.getState().terminals
        .filter((session) => session.workspaceId === workspaceId && session.status === 'running')
        .flatMap((session) => [session.shellLine, session.buffer.slice(-8_000)])
      setEndpoints(extractWorkspaceEndpoints(sources))
    }

    scan()
    const interval = window.setInterval(scan, 3_000)
    return () => window.clearInterval(interval)
  }, [workspaceId, runningKey])

  return endpoints
}

function normalizeCustomEndpoint(rawValue: string): PinnedEndpoint | null {
  let value = rawValue.trim()
  if (!value) return null
  if (/^\d{1,5}$/.test(value)) value = `http://localhost:${value}`
  else if (!/^https?:\/\//i.test(value)) value = `http://${value}`

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) parsed.pathname = ''
    const url = parsed.toString()
    return { url, label: url.replace(/^https?:\/\//, '') }
  } catch {
    return null
  }
}

function LinksPanel({ workspace }: { workspace: WorkspaceRecord }) {
  const saveLink = useAppStore((state) => state.saveLink)
  const deleteLink = useAppStore((state) => state.deleteLink)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  return (
    <div className="links-panel">
      <div className="section-head">
        <h2>Quick Links</h2>
        <span>{workspace.quickLinks.length}</span>
      </div>

      <div className="link-list">
        {workspace.quickLinks.map((link) => (
          <article key={link.id} className="link-row">
            <div className="link-copy">
              <strong title={link.label}>{link.label}</strong>
              <span title={link.url}>{link.url}</span>
            </div>
            <div className="command-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={`Open ${link.label}`}
                title="Open"
                onClick={() => window.workspaceApi.system.openExternal(link.url)}
              >
                <ExternalLink {...iconProps} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Remove ${link.label}`}
                title="Remove"
                onClick={() => deleteLink(workspace.id, link.id)}
              >
                <Trash2 {...iconProps} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <form
        className="link-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!label.trim() || !url.trim()) return
          await saveLink(workspace.id, { label, url })
          setLabel('')
          setUrl('')
        }}
      >
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" />
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
        <button type="submit">Save link</button>
      </form>
    </div>
  )
}

export function WorkspacePanel({ workspace }: { workspace: WorkspaceRecord }) {
  const runCustomAction = useAppStore((state) => state.runCustomAction)
  const saveRunConfiguration = useAppStore((state) => state.saveRunConfiguration)
  const savePinnedEndpoints = useAppStore((state) => state.savePinnedEndpoints)
  const togglePinnedEndpoint = useAppStore((state) => state.togglePinnedEndpoint)
  const rescanWorkspace = useAppStore((state) => state.rescanWorkspace)
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
  const consoleFullscreen = useAppStore((state) => state.consoleFullscreen)
  const scriptsPanelOpen = useAppStore((state) => state.scriptsPanelOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const toggleScriptsPanel = useAppStore((state) => state.toggleScriptsPanel)
  const activeCheckoutPath = useAppStore((state) => state.getSelectedWorktreePath(workspace.id)) ?? workspace.rootPath
  const hasGit =
    Boolean(workspace.gitSummary) ||
    Boolean(workspace.gitWorktreesRoot) ||
    (workspace.gitWorktrees ?? []).length > 0
  const worktreeCount = (workspace.gitWorktrees ?? []).filter((worktree) => !worktree.isBare).length
  const idleWorktreeCount = useMemo(() => {
    const settings = readWorktreeCleanupSettings()
    return selectWorktreesForCleanup(workspace.gitWorktrees ?? [], {
      maxAgeDays: settings.maxAgeDays,
      includeDirty: settings.includeDirty,
      protectPaths: [workspace.rootPath, activeCheckoutPath]
    }).length
  }, [activeCheckoutPath, workspace.gitWorktrees, workspace.rootPath])
  const workspaceEndpoints = useRunningWorkspaceEndpoints(workspace.id)
  const pinnedEndpointConfigs = workspace.pinnedEndpoints ?? []
  const pinnedEndpointUrls = useMemo(
    () => new Set(pinnedEndpointConfigs.map((endpoint) => endpoint.url)),
    [pinnedEndpointConfigs]
  )
  const pinnedWorkspaceEndpoints = useMemo(
    () => pinnedEndpointConfigs.map((pinnedEndpoint) => {
      const activeEndpoint = workspaceEndpoints.find((endpoint) => endpoint.url === pinnedEndpoint.url)
      if (activeEndpoint) return { ...activeEndpoint, label: pinnedEndpoint.label || activeEndpoint.label }
      const parsed = new URL(pinnedEndpoint.url)
      return {
        key: pinnedEndpoint.url,
        label: pinnedEndpoint.label || pinnedEndpoint.url.replace(/^https?:\/\//, ''),
        url: pinnedEndpoint.url,
        port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
      }
    }),
    [pinnedEndpointConfigs, workspaceEndpoints]
  )
  const runActions = workspace.runActions ?? []
  const settings = useAppStore((state) => state.settings)
  const editorTarget = workspace.openTarget ?? settings.defaultOpenTarget
  const [workspaceTab, setWorkspaceTab] = useState<'scripts' | 'docker'>('scripts')
  const [portsExpanded, setPortsExpanded] = useState(false)
  const [addingCustomEndpoint, setAddingCustomEndpoint] = useState(false)
  const [customEndpoint, setCustomEndpoint] = useState('')
  const [customEndpointError, setCustomEndpointError] = useState<string | null>(null)
  const [openMenuOpen, setOpenMenuOpen] = useState(false)
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const [runConfigurationOpen, setRunConfigurationOpen] = useState(false)
  const [draftRunActions, setDraftRunActions] = useState<RunAction[]>([])
  const [draftDefaultRunActionId, setDraftDefaultRunActionId] = useState<string | null>(null)
  const [savingRunConfiguration, setSavingRunConfiguration] = useState(false)
  const [worktreesDialogOpen, setWorktreesDialogOpen] = useState(false)
  const openMenuRef = useRef<HTMLDivElement | null>(null)
  const runMenuRef = useRef<HTMLDivElement | null>(null)
  const defaultRunAction = runActions.find((command) => command.id === workspace.defaultRunActionId) ?? runActions[0] ?? null

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!openMenuRef.current?.contains(event.target as Node)) {
        setOpenMenuOpen(false)
      }
      if (!runMenuRef.current?.contains(event.target as Node)) {
        setRunMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenuOpen(false)
        setRunMenuOpen(false)
        setRunConfigurationOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    setPortsExpanded(false)
    setRunMenuOpen(false)
    setRunConfigurationOpen(false)
  }, [workspace.id])

  function openDefaultTarget() {
    void window.workspaceApi.system.openWorkspace(workspace.id, activeCheckoutPath).catch((error) => useAppStore.setState({ lastActionError: String(error) }))
  }

  function handleSelectEditor(target: EditorTarget) {
    setOpenMenuOpen(false)
    void window.workspaceApi.system.openInEditor(activeCheckoutPath, target)
  }

  function handleOpenExplorer() {
    setOpenMenuOpen(false)
    void window.workspaceApi.system.openPath(activeCheckoutPath)
  }

  function handleOpenTerminal() {
    setOpenMenuOpen(false)
    void window.workspaceApi.system.openInTerminal(activeCheckoutPath)
  }

  function runDefaultAction() {
    if (!defaultRunAction) return
    void runCustomAction(workspace.id, defaultRunAction.id)
  }

  function handleSelectRunAction(action: RunAction) {
    setRunMenuOpen(false)
    if (workspace.defaultRunActionId !== action.id) {
      void saveRunConfiguration(workspace.id, runActions, action.id)
    }
    void runCustomAction(workspace.id, action.id)
  }

  function openRunConfiguration() {
    setRunMenuOpen(false)
    const configuredActions = (workspace.runActions ?? []).map((action) => ({ ...action }))
    if (configuredActions.length === 0) {
      const emptyAction = createEmptyRunAction()
      setDraftRunActions([emptyAction])
      setDraftDefaultRunActionId(emptyAction.id)
    } else {
      setDraftRunActions(configuredActions)
      setDraftDefaultRunActionId(configuredActions.some((action) => action.id === workspace.defaultRunActionId)
        ? workspace.defaultRunActionId ?? null
        : configuredActions[0].id)
    }
    setRunConfigurationOpen(true)
  }

  function createEmptyRunAction(): RunAction {
    return { id: crypto.randomUUID(), command: '', description: '' }
  }

  function updateDraftRunAction(actionId: string, patch: Partial<Pick<RunAction, 'command' | 'description'>>) {
    setDraftRunActions((actions) => actions.map((action) => action.id === actionId ? { ...action, ...patch } : action))
  }

  function addDraftRunAction() {
    const action = createEmptyRunAction()
    setDraftRunActions((actions) => [...actions, action])
    if (!draftDefaultRunActionId) setDraftDefaultRunActionId(action.id)
  }

  function removeDraftRunAction(actionId: string) {
    setDraftRunActions((actions) => {
      const nextActions = actions.filter((action) => action.id !== actionId)
      if (draftDefaultRunActionId === actionId) {
        setDraftDefaultRunActionId(nextActions[0]?.id ?? null)
      }
      return nextActions
    })
  }

  async function submitRunConfiguration() {
    const actions = draftRunActions
      .map((action) => ({ ...action, command: action.command.trim(), description: action.description.trim() }))
      .filter((action) => action.command && action.description)
    setSavingRunConfiguration(true)
    try {
      await saveRunConfiguration(workspace.id, actions, draftDefaultRunActionId)
      setRunConfigurationOpen(false)
    } finally {
      setSavingRunConfiguration(false)
    }
  }

  async function addCustomEndpoint() {
    const endpoint = normalizeCustomEndpoint(customEndpoint)
    if (!endpoint) {
      setCustomEndpointError('Enter a valid port, localhost address, or HTTP(S) URL.')
      return
    }
    try {
      const endpoints = pinnedEndpointUrls.has(endpoint.url)
        ? pinnedEndpointConfigs
        : [...pinnedEndpointConfigs, endpoint]
      await savePinnedEndpoints(workspace.id, endpoints)
      setCustomEndpoint('')
      setCustomEndpointError(null)
      setAddingCustomEndpoint(false)
    } catch {
      setCustomEndpointError('Could not save this endpoint.')
    }
  }

  return (
    <main className={`workspace-shell ${consoleFullscreen ? 'console-fullscreen' : ''}`}>
      <header className="workspace-topbar">
        <div className="workspace-title">
          <div className="workspace-inline">
            <button type="button" className="nav-toggle inline" onClick={toggleSidebar}>
              {sidebarCollapsed ? 'Workspaces' : 'Collapse'}
            </button>
            <p className="eyebrow">Selected Workspace</p>
          </div>
          <h2>{workspace.name}</h2>
          <p className="workspace-checkout-path" title={activeCheckoutPath}>
            {activeCheckoutPath}
          </p>
        </div>

        <div className="workspace-actions">
          <div className="workspace-action-menu" ref={openMenuRef}>
            <div className="workspace-action-group split">
              <button
                type="button"
                className="workspace-open-button"
                title={`Open in ${{ cursor: 'Cursor', vscode: 'VS Code', folder: 'folder', terminal: 'terminal' }[editorTarget]}`}
                onClick={openDefaultTarget}
              >
                <OpenTargetIcon target={editorTarget} />
                <span>Open</span>
              </button>
              <button
                type="button"
                className="workspace-open-toggle"
                aria-label="Open options"
                aria-expanded={openMenuOpen}
                onClick={() => {
                  setRunMenuOpen(false)
                  setOpenMenuOpen((value) => !value)
                }}
              >
                <ChevronDown {...iconProps} />
              </button>
            </div>
            {openMenuOpen && (
              <div className="workspace-open-dropdown">
                <button
                  type="button"
                  className={editorTarget === 'cursor' ? 'active' : ''}
                  onClick={() => handleSelectEditor('cursor')}
                >
                  <CursorIcon />
                  <span>Cursor</span>
                </button>
                <button
                  type="button"
                  className={editorTarget === 'vscode' ? 'active' : ''}
                  onClick={() => handleSelectEditor('vscode')}
                >
                  <VsCodeIcon />
                  <span>VS Code</span>
                </button>
                <button type="button" onClick={handleOpenExplorer}>
                  <Folder {...iconProps} />
                  <span>Explorer</span>
                </button>
                <button type="button" onClick={handleOpenTerminal}>
                  <SquareTerminal {...iconProps} />
                  <span>Terminal</span>
                </button>
              </div>
            )}
          </div>
          <div className="workspace-action-menu" ref={runMenuRef}>
            <div className="workspace-action-group split workspace-run-group">
              <button
                type="button"
                className="workspace-open-button workspace-run-button"
                disabled={!defaultRunAction}
                title={defaultRunAction ? `Run ${defaultRunAction.description}` : 'No run actions configured'}
                onClick={runDefaultAction}
              >
                <Play fill="currentColor" {...iconProps} />
                <span>Run</span>
              </button>
              <button
                type="button"
                className="workspace-open-toggle"
                aria-label="Run options"
                aria-expanded={runMenuOpen}
                onClick={() => {
                  setOpenMenuOpen(false)
                  setRunMenuOpen((value) => !value)
                }}
              >
                <ChevronDown {...iconProps} />
              </button>
            </div>
            {runMenuOpen && (
              <div className="workspace-open-dropdown workspace-run-dropdown">
                <div className="workspace-run-options" role="menu" aria-label="Run actions">
                  {runActions.length === 0 && (
                    <p className="workspace-run-empty">No run actions configured.</p>
                  )}
                  {runActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      className={defaultRunAction?.id === action.id ? 'active' : ''}
                      onClick={() => handleSelectRunAction(action)}
                    >
                      <Play fill="currentColor" {...iconProps} />
                      <span className="workspace-run-dropdown-copy">
                        <strong>{action.description}</strong>
                        <span>{action.command}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="workspace-run-configure">
                  <button type="button" onClick={openRunConfiguration}>
                    <SlidersHorizontal {...iconProps} />
                    <span>Edit configurations…</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          {hasGit && (
            <button
              type="button"
              className="workspace-worktrees-button"
              title={idleWorktreeCount > 0 ? `Manage git worktrees, ${idleWorktreeCount} idle` : 'Manage git worktrees'}
              onClick={() => setWorktreesDialogOpen(true)}
            >
              <GitBranch {...iconProps} />
              <span>Worktrees{worktreeCount > 0 ? ` (${worktreeCount})` : ''}</span>
              {idleWorktreeCount > 0 && (
                <span className="workspace-worktrees-idle">
                  {idleWorktreeCount} idle
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            className="icon-button workspace-actions-icon"
            aria-label="Copy path"
            title="Copy path"
            onClick={() => window.workspaceApi.system.copyText(workspace.rootPath)}
          >
            <Copy {...iconProps} />
          </button>
          <button
            type="button"
            className="solid icon-button workspace-actions-icon"
            aria-label="Refresh workspace"
            title="Refresh workspace"
            onClick={() => rescanWorkspace(workspace.id)}
          >
            <RefreshCw {...iconProps} />
          </button>
        </div>

        <div className="workspace-topbar-rows">
          <WorktreeCheckoutBar workspace={workspace} />
          <div className="workspace-ports">
            <span className="workspace-ports-label">Ports</span>
            <div className="workspace-pinned-ports">
              {pinnedWorkspaceEndpoints.length > 0
                ? pinnedWorkspaceEndpoints.map((endpoint) => (
                    <div key={endpoint.key} className="workspace-pinned-port">
                      <button
                        type="button"
                        className="workspace-port-chip"
                        title={endpoint.url}
                        onClick={() => window.workspaceApi.system.openExternal(endpoint.url)}
                      >
                        <span>{endpoint.label}</span>
                        <ExternalLink {...iconProps} />
                      </button>
                      <button
                        type="button"
                        className="workspace-port-pin is-pinned"
                        title={`Unpin ${endpoint.label}`}
                        aria-label={`Unpin ${endpoint.label}`}
                        onClick={() => void togglePinnedEndpoint(workspace.id, { url: endpoint.url, label: endpoint.label })}
                      >
                        <Pin fill="currentColor" {...iconProps} />
                      </button>
                    </div>
                  ))
                : <span className="workspace-ports-empty">Pin ports to keep them here.</span>}
            </div>
            <button
              type="button"
              className="workspace-ports-toggle"
              aria-expanded={portsExpanded}
              disabled={workspaceEndpoints.length === 0}
              onClick={() => setPortsExpanded((value) => !value)}
            >
              <span>{portsExpanded ? 'Hide ports' : `All ports (${workspaceEndpoints.length})`}</span>
              <ChevronDown {...iconProps} />
            </button>
            <button
              type="button"
              className="workspace-add-port-button"
              onClick={() => {
                setAddingCustomEndpoint((value) => !value)
                setCustomEndpointError(null)
              }}
            >
              Add URL
            </button>
            {addingCustomEndpoint && (
              <form
                className="workspace-custom-port-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void addCustomEndpoint()
                }}
              >
                <input
                  autoFocus
                  value={customEndpoint}
                  onChange={(event) => {
                    setCustomEndpoint(event.target.value)
                    setCustomEndpointError(null)
                  }}
                  placeholder="3000, localhost:3000, or https://…"
                  aria-label="Custom port or URL"
                />
                <button type="submit">Pin</button>
                <button type="button" onClick={() => setAddingCustomEndpoint(false)}>Cancel</button>
                {customEndpointError && <p>{customEndpointError}</p>}
              </form>
            )}
            {portsExpanded && (
              <div className="workspace-ports-panel">
                <div className="workspace-ports-list">
                  {workspaceEndpoints.map((endpoint) => {
                    const isPinned = pinnedEndpointUrls.has(endpoint.url)
                    return (
                      <div key={endpoint.key} className="workspace-port-option">
                        <button
                          type="button"
                          className="workspace-port-chip"
                          title={endpoint.url}
                          onClick={() => window.workspaceApi.system.openExternal(endpoint.url)}
                        >
                          <span>{endpoint.label}</span>
                          <ExternalLink {...iconProps} />
                        </button>
                        <button
                          type="button"
                          className={`workspace-port-pin${isPinned ? ' is-pinned' : ''}`}
                          title={`${isPinned ? 'Unpin' : 'Pin'} ${endpoint.label}`}
                          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${endpoint.label}`}
                          onClick={() => void togglePinnedEndpoint(workspace.id, { url: endpoint.url, label: endpoint.label })}
                        >
                          <Pin fill={isPinned ? 'currentColor' : 'none'} {...iconProps} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="workspace-grid">
        <div className="workspace-primary">
          <TerminalDock workspace={workspace} />
        </div>

        <aside className="workspace-inspector">
          <section className="inspector-card">
            <div className="panel-switcher">
              <div className="panel-switch-tabs" role="tablist" aria-label="Inspector panel">
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'scripts'}
                  className={workspaceTab === 'scripts' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('scripts')}
                >
                  Scripts
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'docker'}
                  className={workspaceTab === 'docker' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('docker')}
                >
                  Docker
                </button>
              </div>
              <button
                type="button"
                className="inspector-toggle"
                aria-expanded={scriptsPanelOpen}
                aria-label={scriptsPanelOpen ? 'Hide panel' : 'Show panel'}
                onClick={toggleScriptsPanel}
              >
                {scriptsPanelOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {scriptsPanelOpen && (workspaceTab === 'scripts'
              ? <CommandPanel workspace={workspace} />
              : <DockerPanel workspace={workspace} />)}
          </section>

          <section className="inspector-card">
            <LinksPanel workspace={workspace} />
          </section>
        </aside>
      </div>

      <WorktreesDialog
        workspaceId={workspace.id}
        open={worktreesDialogOpen}
        onClose={() => setWorktreesDialogOpen(false)}
      />
      {runConfigurationOpen && (
        <div
          className="command-chain-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRunConfigurationOpen(false)
          }}
        >
          <section
            className="run-configuration-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="run-configuration-title"
          >
            <div className="run-configuration-head">
              <div>
                <p className="eyebrow">Workspace action</p>
                <h2 id="run-configuration-title">Configure Run</h2>
              </div>
              <button type="button" aria-label="Close run configuration" onClick={() => setRunConfigurationOpen(false)}>
                <X {...iconProps} />
              </button>
            </div>
            <p className="run-configuration-description">
              Add the shell commands you want available for this workspace. The description is shown in the Run menu.
            </p>
            <div className="run-configuration-list">
              {draftRunActions.length === 0 && (
                <p className="run-configuration-empty">No custom actions yet.</p>
              )}
              {draftRunActions.map((action, index) => {
                const complete = Boolean(action.command.trim() && action.description.trim())
                return (
                  <div key={action.id} className={`run-configuration-row${draftDefaultRunActionId === action.id ? ' selected' : ''}`}>
                    <div className="run-configuration-row-head">
                      <strong>Action {index + 1}</strong>
                      <div>
                        <label className="run-configuration-default" title="Use as the default Run action">
                          <input
                            type="radio"
                            name="default-run-action"
                            checked={draftDefaultRunActionId === action.id}
                            disabled={!complete}
                            onChange={() => setDraftDefaultRunActionId(action.id)}
                          />
                          <span>Default</span>
                        </label>
                        <button type="button" onClick={() => removeDraftRunAction(action.id)}>Remove</button>
                      </div>
                    </div>
                    <label className="run-configuration-field">
                      <span>Description</span>
                      <input
                        autoFocus={index === 0 && !(workspace.runActions ?? []).length}
                        value={action.description}
                        placeholder="Start development server"
                        onChange={(event) => updateDraftRunAction(action.id, { description: event.target.value })}
                      />
                    </label>
                    <label className="run-configuration-field">
                      <span>Command</span>
                      <input
                        value={action.command}
                        placeholder="pnpm dev"
                        spellCheck={false}
                        onChange={(event) => updateDraftRunAction(action.id, { command: event.target.value })}
                      />
                    </label>
                  </div>
                )
              })}
              <button type="button" className="run-configuration-add" onClick={addDraftRunAction}>+ Add action</button>
            </div>
            <div className="run-configuration-footer">
              <span>{draftRunActions.filter((action) => action.command.trim() && action.description.trim()).length} configured</span>
              <div>
                <button type="button" onClick={() => setRunConfigurationOpen(false)}>Cancel</button>
                <button
                  type="button"
                  className="solid"
                  disabled={savingRunConfiguration || draftRunActions.some((action) => !action.command.trim() || !action.description.trim())}
                  onClick={() => void submitRunConfiguration()}
                >
                  {savingRunConfiguration ? 'Saving…' : 'Save configuration'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
