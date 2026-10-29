import React, { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderInput,
  GripVertical,
  Palette,
  OctagonX,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { GroupRecord, WorkspaceRecord } from '@shared/types'
import { groupWorkspaces, workspacesInGroup } from '@shared/workspaceGroups'
import { workspacePackageManager } from '@shared/workspaceModel'
import { SidebarRowMenu, type SidebarRowMenuItem } from '@renderer/components/SidebarRowMenu'
import { UNGROUPED_KEY, useAppStore, useVisibleWorkspaces } from '@renderer/store/useAppStore'

const menuIconProps = { size: 15, strokeWidth: 1.75, 'aria-hidden': true as const }
const WORKSPACE_DRAG_MIME = 'application/x-workspace-id'
export const GROUP_COLORS = ['#ffc857', '#68d391', '#76c5ff', '#c084fc', '#ff6978', '#7dd3fc'] as const

function stopRowClick(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
  event.stopPropagation()
}

/** Where a drop lands: a group (null = ungrouped) and a position within it. */
interface DropTarget {
  groupId: string | null
  index: number
  key: string
}

type InlineEditor =
  | { kind: 'new-group' }
  | { kind: 'rename-group'; groupId: string }
  | { kind: 'color-group'; groupId: string }
  | { kind: 'rename-workspace'; workspaceId: string }
  | { kind: 'move-workspace'; workspaceId: string }

export function SidebarTree() {
  const groups = useAppStore((state) => state.groups)
  const allWorkspaces = useAppStore((state) => state.workspaces)
  const search = useAppStore((state) => state.search)
  const selectedWorkspaceId = useAppStore((state) => state.selectedWorkspaceId)
  const collapsedGroupIds = useAppStore((state) => state.collapsedGroupIds)
  const toggleGroupCollapsed = useAppStore((state) => state.toggleGroupCollapsed)
  const setSelectedWorkspace = useAppStore((state) => state.setSelectedWorkspace)
  const createGroup = useAppStore((state) => state.createGroup)
  const renameGroup = useAppStore((state) => state.renameGroup)
  const deleteGroup = useAppStore((state) => state.deleteGroup)
  const moveGroup = useAppStore((state) => state.moveGroup)
  const setGroupColor = useAppStore((state) => state.setGroupColor)
  const rescanWorkspace = useAppStore((state) => state.rescanWorkspace)
  const removeWorkspace = useAppStore((state) => state.removeWorkspace)
  const moveWorkspace = useAppStore((state) => state.moveWorkspace)
  const moveWorkspaceTo = useAppStore((state) => state.moveWorkspaceTo)
  const renameWorkspace = useAppStore((state) => state.renameWorkspace)
  const toggleWorkspacePause = useAppStore((state) => state.toggleWorkspacePause)
  const pauseGroupTerminals = useAppStore((state) => state.pauseGroupTerminals)
  const resumeGroupTerminals = useAppStore((state) => state.resumeGroupTerminals)
  const killGroupTerminals = useAppStore((state) => state.killGroupTerminals)
  const runningKey = useAppStore((state) =>
    state.terminals.filter((session) => session.status === 'running').map((session) => session.workspaceId).sort().join(','))
  const pausedKey = useAppStore((state) =>
    state.terminals.filter((session) => session.workspacePaused).map((session) => session.workspaceId).sort().join(','))
  const consoleWorkspaceKey = useAppStore((state) =>
    [...new Set(state.terminals.map((session) => session.workspaceId))].sort().join(','))
  const visibleWorkspaces = useVisibleWorkspaces()
  const running = useMemo(() => new Set(runningKey.split(',').filter(Boolean)), [runningKey])
  const paused = useMemo(() => new Set(pausedKey.split(',').filter(Boolean)), [pausedKey])
  const withConsoles = useMemo(() => new Set(consoleWorkspaceKey.split(',').filter(Boolean)), [consoleWorkspaceKey])
  const tree = useMemo(() => groupWorkspaces(groups, visibleWorkspaces), [groups, visibleWorkspaces])
  const searching = search.trim().length > 0

  const [editor, setEditor] = useState<InlineEditor | null>(null)
  const [draftName, setDraftName] = useState('')
  const [moveTargetGroupId, setMoveTargetGroupId] = useState('')
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)

  const isPaused = (workspaceId: string) => paused.has(workspaceId) && !running.has(workspaceId)
  const isCollapsed = (key: string) => !searching && collapsedGroupIds.includes(key)

  function openEditor(next: InlineEditor, name = '') {
    setEditor(next)
    setDraftName(name)
  }

  function closeEditor() {
    setEditor(null)
    setDraftName('')
  }

  async function submitEditor() {
    if (!editor) return
    const name = draftName.trim()
    if (editor.kind === 'new-group' && name) await createGroup(name)
    if (editor.kind === 'rename-group' && name) await renameGroup(editor.groupId, name)
    if (editor.kind === 'rename-workspace' && name) await renameWorkspace(editor.workspaceId, name)
    if (editor.kind === 'move-workspace') {
      const groupId = moveTargetGroupId || null
      await moveWorkspaceTo(editor.workspaceId, groupId, workspacesInGroup(allWorkspaces, groupId).length)
    }
    closeEditor()
  }

  function dropHandlers(target: DropTarget) {
    const accept = (event: DragEvent<HTMLElement>) => {
      if (!draggingId) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dropKey !== target.key) setDropKey(target.key)
    }
    return {
      onDragEnter: accept,
      onDragOver: accept,
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        const related = event.relatedTarget as Node | null
        if (related && event.currentTarget.contains(related)) return
        if (dropKey === target.key) setDropKey(null)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
        const sourceId = event.dataTransfer.getData(WORKSPACE_DRAG_MIME) || event.dataTransfer.getData('text/plain')
        setDropKey(null)
        setDraggingId(null)
        if (sourceId) void moveWorkspaceTo(sourceId, target.groupId, target.index)
      }
    }
  }

  function groupMenuItems(group: GroupRecord, index: number): SidebarRowMenuItem[] {
    const members = workspacesInGroup(allWorkspaces, group.id)
    const hasRunning = members.some((workspace) => running.has(workspace.id))
    const hasPaused = members.some((workspace) => paused.has(workspace.id))
    const hasConsoles = members.some((workspace) => withConsoles.has(workspace.id))
    return [
      { id: 'pause', label: 'Pause group consoles', icon: <Pause {...menuIconProps} />, disabled: !hasRunning, onSelect: () => void pauseGroupTerminals(group.id) },
      { id: 'resume', label: 'Resume group consoles', icon: <Play {...menuIconProps} />, disabled: !hasPaused, onSelect: () => void resumeGroupTerminals(group.id) },
      { id: 'kill', label: 'Kill group consoles', icon: <OctagonX {...menuIconProps} />, disabled: !hasConsoles, danger: true, onSelect: () => {
        if (window.confirm(`Stop and remove all consoles in "${group.name}", including their history and pins?`)) void killGroupTerminals(group.id)
      } },
      { id: 'rename', label: 'Rename', icon: <Pencil {...menuIconProps} />, onSelect: () => openEditor({ kind: 'rename-group', groupId: group.id }, group.name) },
      { id: 'color', label: 'Set color…', icon: <Palette {...menuIconProps} />, onSelect: () => openEditor({ kind: 'color-group', groupId: group.id }) },
      { id: 'up', label: 'Move up', icon: <ArrowUp {...menuIconProps} />, disabled: index === 0, onSelect: () => void moveGroup(group.id, -1) },
      { id: 'down', label: 'Move down', icon: <ArrowDown {...menuIconProps} />, disabled: index === groups.length - 1, onSelect: () => void moveGroup(group.id, 1) },
      {
        id: 'delete',
        label: 'Delete group',
        icon: <Trash2 {...menuIconProps} />,
        danger: true,
        onSelect: () => {
          if (!window.confirm(`Delete group "${group.name}"? Its workspaces move to Ungrouped.`)) return
          void deleteGroup(group.id)
        }
      }
    ]
  }

  function workspaceMenuItems(workspace: WorkspaceRecord): SidebarRowMenuItem[] {
    const siblings = workspacesInGroup(allWorkspaces, workspace.groupId)
    const index = siblings.findIndex((entry) => entry.id === workspace.id)
    return [
      { id: 'up', label: 'Move up', icon: <ArrowUp {...menuIconProps} />, disabled: index <= 0, onSelect: () => void moveWorkspace(workspace.id, -1) },
      { id: 'down', label: 'Move down', icon: <ArrowDown {...menuIconProps} />, disabled: index === siblings.length - 1, onSelect: () => void moveWorkspace(workspace.id, 1) },
      {
        id: 'move',
        label: 'Move to group…',
        icon: <FolderInput {...menuIconProps} />,
        onSelect: () => {
          setMoveTargetGroupId(workspace.groupId ?? '')
          openEditor({ kind: 'move-workspace', workspaceId: workspace.id })
        }
      },
      { id: 'rename', label: 'Rename', icon: <Pencil {...menuIconProps} />, onSelect: () => openEditor({ kind: 'rename-workspace', workspaceId: workspace.id }, workspace.name) },
      { id: 'rescan', label: 'Refresh workspace', icon: <RefreshCw {...menuIconProps} />, onSelect: () => void rescanWorkspace(workspace.id) },
      {
        id: 'remove',
        label: 'Remove from list',
        icon: <Trash2 {...menuIconProps} />,
        danger: true,
        onSelect: () => {
          if (!window.confirm(`Remove workspace "${workspace.name}" from Workspace Manager?`)) return
          void removeWorkspace(workspace.id)
        }
      }
    ]
  }

  function renderNameForm(label: string, placeholder?: string) {
    return (
      <form
        className="sidebar-inline-form"
        aria-label={label}
        onSubmit={(event) => {
          event.preventDefault()
          void submitEditor()
        }}
      >
        <input autoFocus aria-label={label} value={draftName} placeholder={placeholder} onChange={(event) => setDraftName(event.target.value)} />
        <div className="sidebar-inline-form-actions">
          <button type="submit">Save</button>
          <button type="button" onClick={closeEditor}>Cancel</button>
        </div>
      </form>
    )
  }

  function renderColorForm(group: GroupRecord) {
    const choose = (color: string | null) => {
      void setGroupColor(group.id, color)
      closeEditor()
    }
    return (
      <div className="sidebar-inline-form group-color-form" role="group" aria-label={`Color for ${group.name}`}>
        <div className="group-color-swatches">
          {GROUP_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`group-color-swatch${group.color === color ? ' active' : ''}`}
              style={{ background: color }}
              aria-label={`Use ${color}`}
              aria-pressed={group.color === color}
              onClick={() => choose(color)}
            />
          ))}
          <button type="button" className="group-color-clear" onClick={() => choose(null)}>None</button>
        </div>
        <div className="sidebar-inline-form-actions">
          <button type="button" onClick={closeEditor}>Cancel</button>
        </div>
      </div>
    )
  }

  function renderPauseButton(workspace: WorkspaceRecord) {
    const hasRunning = running.has(workspace.id)
    const workspacePaused = isPaused(workspace.id)
    if (!workspacePaused && !hasRunning) return null
    const label = workspacePaused ? 'Resume workspace consoles' : 'Pause workspace consoles'
    return (
      <button
        type="button"
        className={`project-pause-button${workspacePaused ? ' is-paused' : ''}`}
        title={`${label}: ${workspace.name}`}
        aria-label={`${label}: ${workspace.name}`}
        onClick={(event) => {
          stopRowClick(event)
          void toggleWorkspacePause(workspace.id)
        }}
      >
        {workspacePaused ? <Play size={15} strokeWidth={2} aria-hidden="true" /> : <Pause size={15} strokeWidth={2} aria-hidden="true" />}
      </button>
    )
  }

  function renderWorkspace(workspace: WorkspaceRecord) {
    const key = `workspace:${workspace.id}`
    // Search can hide siblings, so the drop position comes from the full group.
    const index = workspacesInGroup(allWorkspaces, workspace.groupId).findIndex((entry) => entry.id === workspace.id)
    const editing = editor && 'workspaceId' in editor && editor.workspaceId === workspace.id ? editor : null
    const classes = [
      'sidebar-row-shell project-row-shell',
      selectedWorkspaceId === workspace.id ? 'active' : '',
      draggingId === workspace.id ? 'dragging' : '',
      dropKey === key && draggingId !== workspace.id ? 'drop-target' : ''
    ].filter(Boolean).join(' ')
    return (
      <div key={workspace.id} className={classes} {...dropHandlers({ groupId: workspace.groupId, index, key })}>
        <div
          className="sidebar-drag-handle"
          role="button"
          tabIndex={0}
          draggable
          title="Drag to reorder or move to another group"
          aria-label={`Reorder ${workspace.name}`}
          onDragStart={(event) => {
            event.stopPropagation()
            event.dataTransfer.setData(WORKSPACE_DRAG_MIME, workspace.id)
            event.dataTransfer.setData('text/plain', workspace.id)
            event.dataTransfer.effectAllowed = 'move'
            setDraggingId(workspace.id)
          }}
          onDragEnd={() => {
            setDraggingId(null)
            setDropKey(null)
          }}
        >
          <GripVertical size={14} strokeWidth={1.75} aria-hidden="true" />
        </div>
        {editing?.kind === 'rename-workspace' ? renderNameForm(`Rename ${workspace.name}`) : editing?.kind === 'move-workspace' ? (
          <form
            className="sidebar-inline-form"
            aria-label={`Move ${workspace.name} to group`}
            onSubmit={(event) => {
              event.preventDefault()
              void submitEditor()
            }}
          >
            <select autoFocus aria-label="Destination group" value={moveTargetGroupId} onChange={(event) => setMoveTargetGroupId(event.target.value)}>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              <option value="">Ungrouped</option>
            </select>
            <div className="sidebar-inline-form-actions">
              <button type="submit">Move</button>
              <button type="button" onClick={closeEditor}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <button
              type="button"
              className={`project-row ${selectedWorkspaceId === workspace.id ? 'active' : ''}${running.has(workspace.id) ? ' has-running-console' : ''}${isPaused(workspace.id) ? ' is-paused' : ''}`}
              onClick={() => setSelectedWorkspace(workspace.id)}
            >
              <div className="project-row-top">
                <strong className="project-row-title" title={workspace.name}>{workspace.name}</strong>
                <span className="project-row-tag">{workspacePackageManager(workspace).toUpperCase()}</span>
              </div>
              <p className="project-row-path" title={workspace.rootPath}>{workspace.rootPath}</p>
            </button>
            {renderPauseButton(workspace)}
            <SidebarRowMenu
              menuKey={key}
              label={workspace.name}
              openMenuKey={openMenuKey}
              onOpenChange={setOpenMenuKey}
              items={workspaceMenuItems(workspace)}
            />
          </>
        )}
      </div>
    )
  }

  function renderSection(section: { key: string; group: GroupRecord | null; workspaces: WorkspaceRecord[]; groupIndex: number }) {
    const { key, group, workspaces } = section
    const collapsed = isCollapsed(key)
    const name = group?.name ?? 'Ungrouped'
    const headerKey = `group:${key}`
    const editing = group && editor && 'groupId' in editor && editor.groupId === group.id ? editor : null
    const total = group ? workspacesInGroup(allWorkspaces, group.id).length : workspaces.length
    return (
      <section key={key} className={`sidebar-group${collapsed ? ' collapsed' : ''}`} aria-label={name}>
        <div
          className={`sidebar-row-shell sidebar-group-head${dropKey === headerKey ? ' drop-target' : ''}`}
          {...dropHandlers({ groupId: group?.id ?? null, index: total, key: headerKey })}
        >
          {editing?.kind === 'rename-group' ? renderNameForm(`Rename ${name}`) : editing?.kind === 'color-group' && group ? renderColorForm(group) : (
            <>
              <button
                type="button"
                className="sidebar-group-toggle"
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}`}
                onClick={() => toggleGroupCollapsed(key)}
              >
                {collapsed ? <ChevronRight {...menuIconProps} /> : <ChevronDown {...menuIconProps} />}
                <span className="sidebar-group-dot" style={group?.color ? { background: group.color } : undefined} aria-hidden="true" />
                <span className="sidebar-group-name" title={name}>{name}</span>
                <span className="sidebar-group-count">{workspaces.length}</span>
              </button>
              {group ? (
                <SidebarRowMenu
                  menuKey={headerKey}
                  label={name}
                  openMenuKey={openMenuKey}
                  onOpenChange={setOpenMenuKey}
                  items={groupMenuItems(group, section.groupIndex)}
                />
              ) : null}
            </>
          )}
        </div>
        {!collapsed && (
          <div className="sidebar-group-items">
            {workspaces.map((workspace) => renderWorkspace(workspace))}
            {workspaces.length === 0 && !searching && <p className="sidebar-group-empty">Drop a workspace here</p>}
          </div>
        )}
      </section>
    )
  }

  const sections = [
    ...tree.groups
      .map((entry, groupIndex) => ({ key: entry.group.id, group: entry.group, workspaces: entry.workspaces, groupIndex }))
      .filter((section) => !searching || section.workspaces.length > 0),
    ...(tree.ungrouped.length > 0 || groups.length === 0 || draggingId
      ? [{ key: UNGROUPED_KEY, group: null, workspaces: tree.ungrouped, groupIndex: -1 }]
      : [])
  ]

  return (
    <section className="project-list sidebar-section">
      <div className="section-head compact">
        <h2>Workspaces</h2>
        <div className="sidebar-section-tools">
          <span>{allWorkspaces.length}</span>
          <button
            type="button"
            className="sidebar-utility-button"
            title="Create group"
            aria-label="Create group"
            onClick={(event) => {
              stopRowClick(event)
              if (editor?.kind === 'new-group') closeEditor()
              else openEditor({ kind: 'new-group' })
            }}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={`sidebar-list sidebar-projects${draggingId ? ' is-reordering' : ''}`}>
        {editor?.kind === 'new-group' && renderNameForm('New group name', 'New group')}
        {sections.map((section) => renderSection(section))}
        {allWorkspaces.length === 0 && (
          <div className="empty-state compact">
            <strong>No workspaces yet.</strong>
            <p>Import a folder to populate the workspace list.</p>
          </div>
        )}
        {allWorkspaces.length > 0 && visibleWorkspaces.length === 0 && (
          <p className="sidebar-group-empty">No workspaces match “{search.trim()}”.</p>
        )}
      </div>
    </section>
  )
}
