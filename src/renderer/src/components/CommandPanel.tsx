import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ListOrdered,
  Pin,
  Play,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import type { CommandDescriptor, CommandGroup, WorkspaceRecord } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { CommandGroupHeader, PrerequisiteSelect, commandKindLabel, groupMatchesSearch } from '@renderer/components/commandGroups'

const COMMAND_SEARCH_DEBOUNCE_MS = 250
const iconProps = { strokeWidth: 1.75, 'aria-hidden': true as const }

function prerequisiteSummary(command: CommandDescriptor) {
  if (command.prerequisiteTitles.length === 0) return null
  if (command.prerequisiteTitles.length === 1) return `Pre: ${command.prerequisiteTitles[0]}`
  return `${command.prerequisiteTitles.length} steps before run`
}

function uniqueCommands(commands: CommandDescriptor[]) {
  return commands.filter((command, index, values) => values.findIndex((item) => item.id === command.id) === index)
}

function commandPreview(command: CommandDescriptor, featured: boolean) {
  const isSynthetic = command.id.includes('::synthetic::')
  if (featured && !isSynthetic) {
    return `${command.packageManager} run ${command.name}`
  }

  return command.script
}

function commandMatchesSearch(command: CommandDescriptor, query: string) {
  const searchable = [
    command.title,
    command.name,
    command.script,
    command.projectName ?? '',
    command.packageManager
  ].join(' ').toLowerCase()

  return searchable.includes(query)
}

function filterCommandGroups(groups: CommandGroup[], query: string) {
  if (!query) return groups

  return groups
    .map((group) => groupMatchesSearch(group, query) ? group : ({
      ...group,
      commands: group.commands.filter((command) => commandMatchesSearch(command, query))
    }))
    .filter((group) => group.commands.length > 0)
}

export function CommandPanel({ workspace }: { workspace: WorkspaceRecord }) {
  const commandList = useAppStore((state) => state.commandLists[workspace.id])
  const runCommand = useAppStore((state) => state.runCommand)
  const toggleFavoriteCommand = useAppStore((state) => state.toggleFavoriteCommand)
  const setCommandChain = useAppStore((state) => state.setCommandChain)
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null)
  const [draftPrerequisiteIds, setDraftPrerequisiteIds] = useState<string[]>([])
  const [pendingAddId, setPendingAddId] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const allCommands = useMemo(
    () => commandList ? uniqueCommands(commandList.groups.flatMap((group) => group.commands)) : [],
    [commandList]
  )
  const commandIndex = useMemo(
    () => new Map(allCommands.map((command) => [command.id, command])),
    [allCommands]
  )
  const editingCommand = editingCommandId ? commandIndex.get(editingCommandId) ?? null : null
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredFavorites = useMemo(
    () => normalizedSearchQuery
      ? commandList?.favorites.filter((command) => commandMatchesSearch(command, normalizedSearchQuery)) ?? []
      : commandList?.favorites ?? [],
    [commandList, normalizedSearchQuery]
  )
  const filteredGroups = useMemo(
    () => commandList ? filterCommandGroups(commandList.groups, normalizedSearchQuery) : [],
    [commandList, normalizedSearchQuery]
  )
  const hasSearchResults = filteredFavorites.length > 0 || filteredGroups.some((group) => group.commands.length > 0)

  useEffect(() => {
    if (searchDraft === searchQuery) return

    const timeout = window.setTimeout(() => {
      setSearchQuery(searchDraft)
    }, COMMAND_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [searchDraft, searchQuery])

  useEffect(() => {
    if (!editingCommand) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setEditingCommandId(null)
      setDraftPrerequisiteIds([])
      setPendingAddId('')
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [editingCommand])

  if (!commandList) {
    return <p className="muted">Loading workspace scripts…</p>
  }

  function startEditing(command: CommandDescriptor) {
    setEditingCommandId(command.id)
    setDraftPrerequisiteIds(command.prerequisiteCommandIds)
    setPendingAddId('')
  }

  async function submitChain(commandId: string) {
    await setCommandChain(workspace.id, commandId, draftPrerequisiteIds)
    setEditingCommandId(null)
    setDraftPrerequisiteIds([])
    setPendingAddId('')
  }

  function renderCommand(command: CommandDescriptor, featured = false) {
    const summary = prerequisiteSummary(command)
    const preview = commandPreview(command, featured)
    const kind = commandKindLabel(command)

    return (
      <article key={command.id} className={`command-card ${featured ? 'featured' : ''} ${editingCommandId === command.id ? 'editing' : ''}`}>
        <div className="command-row">
          <div className="command-copy">
            <strong title={command.title}>
              <span>{command.title}</span>
              {kind && <small className="command-kind-badge">{kind}</small>}
            </strong>
            <span title={preview}>
              {preview}
            </span>
            {summary && (
              <small className="command-summary" title={command.prerequisiteTitles.join(' -> ')}>
                {summary}
              </small>
            )}
          </div>
          <div className="command-actions">
            <button
              type="button"
              className={`icon-button ${command.favorite ? 'active' : ''}`}
              aria-label={`${command.favorite ? 'Unpin' : 'Pin'} ${command.title}`}
              title={command.favorite ? 'Unpin command' : 'Pin command'}
              onClick={() => toggleFavoriteCommand(workspace.id, command.id)}
            >
              <Pin fill={command.favorite ? 'currentColor' : 'none'} {...iconProps} />
            </button>
            <button
              type="button"
              className={`icon-button ${command.hasChain ? 'active' : ''}`}
              aria-label={`Configure steps for ${command.title}`}
              title="Configure steps"
              onClick={() => {
                if (editingCommandId === command.id) {
                  setEditingCommandId(null)
                  setDraftPrerequisiteIds([])
                  setPendingAddId('')
                  return
                }
                startEditing(command)
              }}
            >
              <ListOrdered {...iconProps} />
            </button>
            <button
              type="button"
              className="solid icon-button run-button"
              aria-label={`Run ${command.title}`}
              title="Run command"
              onClick={() => runCommand(command.id)}
            >
              <Play fill="currentColor" {...iconProps} />
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="command-panel-body command-panel-shell">
      <div className={`command-panel-content ${editingCommand ? 'dialog-open' : ''}`}>
        <label className="command-search">
          <span>Search commands</span>
          <input
            type="search"
            value={searchDraft}
            placeholder="Filter by name, script, or project"
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </label>

        {!hasSearchResults && normalizedSearchQuery && (
          <p className="muted command-search-empty">No commands match "{searchQuery.trim()}".</p>
        )}

        {filteredFavorites.length > 0 && (
          <div className="command-group">
            <p className="group-label">Pinned</p>
            <div className="command-grid">
              {filteredFavorites.map((command) => renderCommand(command, true))}
            </div>
          </div>
        )}

        {filteredGroups.map((group) => (
          <div key={group.key} className="command-group">
            <CommandGroupHeader group={group} />
            <div className="command-grid">
              {group.commands.map((command) => renderCommand(command))}
            </div>
          </div>
        ))}
      </div>

      {editingCommand && (
        <div
          className="command-chain-backdrop"
          onClick={() => {
            setEditingCommandId(null)
            setDraftPrerequisiteIds([])
            setPendingAddId('')
          }}
        >
          <section
            className="command-chain-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="command-chain-dialog-head">
              <div>
                <p className="group-label">Command Steps</p>
                <h3>{editingCommand.title}</h3>
                <span>{commandPreview(editingCommand, commandList.favorites.some((item) => item.id === editingCommand.id))}</span>
              </div>
              <button
                type="button"
                className="sidebar-row-action"
                title="Close steps editor"
                onClick={() => {
                  setEditingCommandId(null)
                  setDraftPrerequisiteIds([])
                  setPendingAddId('')
                }}
              >
                <X {...iconProps} />
              </button>
            </div>

            <div className="command-chain-dialog-copy">
              <p>Run these setup steps first, in order. The target command starts only after every prerequisite succeeds.</p>
            </div>

            <div className="command-chain-editor">
              <div className="command-chain-list">
                {draftPrerequisiteIds.length > 0 ? draftPrerequisiteIds.map((prerequisiteId, index) => {
                  const prerequisite = commandIndex.get(prerequisiteId)
                  if (!prerequisite) return null
                  return (
                    <div key={prerequisiteId} className="command-chain-step">
                      <div className="command-chain-step-copy">
                        <strong>{prerequisite.title}</strong>
                        <span>{prerequisite.script}</span>
                      </div>
                      <div className="command-chain-step-actions">
                        <button
                          type="button"
                          className="sidebar-row-action"
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => {
                            setDraftPrerequisiteIds((current) => {
                              const next = [...current]
                              ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                              return next
                            })
                          }}
                        >
                          <ArrowUp {...iconProps} />
                        </button>
                        <button
                          type="button"
                          className="sidebar-row-action"
                          title="Move down"
                          disabled={index === draftPrerequisiteIds.length - 1}
                          onClick={() => {
                            setDraftPrerequisiteIds((current) => {
                              const next = [...current]
                              ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                              return next
                            })
                          }}
                        >
                          <ArrowDown {...iconProps} />
                        </button>
                        <button
                          type="button"
                          className="sidebar-row-action danger"
                          title="Remove step"
                          onClick={() => {
                            setDraftPrerequisiteIds((current) => current.filter((item) => item !== prerequisiteId))
                          }}
                        >
                          <X {...iconProps} />
                        </button>
                      </div>
                    </div>
                  )
                }) : (
                  <p className="command-chain-empty">No prerequisite steps yet.</p>
                )}
              </div>

              <div className="command-chain-add">
                <PrerequisiteSelect
                  groups={commandList.groups}
                  excludeIds={[editingCommand.id, ...draftPrerequisiteIds]}
                  value={pendingAddId}
                  onChange={setPendingAddId}
                />
                <button
                  type="button"
                  className="icon-button command-chain-icon-button"
                  aria-label="Add prerequisite"
                  title="Add prerequisite"
                  onClick={() => {
                    if (!pendingAddId) return
                    setDraftPrerequisiteIds((current) => [...current, pendingAddId])
                    setPendingAddId('')
                  }}
                >
                  <Plus {...iconProps} />
                </button>
              </div>

              <div className="command-chain-footer">
                <button
                  type="button"
                  className="solid icon-button command-chain-icon-button"
                  aria-label="Save steps"
                  title="Save steps"
                  onClick={() => void submitChain(editingCommand.id)}
                >
                  <Check {...iconProps} />
                </button>
                {draftPrerequisiteIds.length > 0 && (
                  <button
                    type="button"
                    className="icon-button command-chain-icon-button"
                    aria-label="Clear steps"
                    title="Clear steps"
                    onClick={() => {
                      setDraftPrerequisiteIds([])
                    }}
                  >
                    <Trash2 {...iconProps} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button command-chain-icon-button"
                  aria-label="Cancel"
                  title="Cancel"
                  onClick={() => {
                    setEditingCommandId(null)
                    setDraftPrerequisiteIds([])
                    setPendingAddId('')
                  }}
                >
                  <X {...iconProps} />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
