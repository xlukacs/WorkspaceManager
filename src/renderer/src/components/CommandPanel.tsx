import React, { useEffect, useMemo, useState } from 'react'
import type { CommandDescriptor, CommandGroup, WorkspaceRecord } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { CommandGroupHeader, PrerequisiteSelect, commandKindLabel, groupMatchesSearch } from '@renderer/components/commandGroups'

const COMMAND_SEARCH_DEBOUNCE_MS = 250

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

function PlayIcon() {
  return (
    <svg className="play-glyph" aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M6.3 4.86c0-1.04 1.14-1.67 2.02-1.1l7.62 4.89c.81.52.81 1.7 0 2.22l-7.62 4.89c-.88.57-2.02-.06-2.02-1.1V4.86Z"
        fill="currentColor"
      />
    </svg>
  )
}

function StepsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M4.5 5.5h5M4.5 10h11M4.5 14.5h7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <circle cx="13.5" cy="5.5" r="1.6" fill="currentColor" />
      <circle cx="12.5" cy="14.5" r="1.6" fill="currentColor" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.25 9.5 3.75-3.75 3.75 3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.25 6.5 3.75 3.75 3.75-3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
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

function AddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M8 3.2v9.6M3.2 8h9.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="m3.4 8.2 3.1 3.1 6.1-6.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M6.5 2.75a.75.75 0 0 1 .73-.6h1.54a.75.75 0 0 1 .73.6l.12.6h2.13a.75.75 0 0 1 0 1.5h-.33l-.47 7.14a1.5 1.5 0 0 1-1.5 1.4H6.55a1.5 1.5 0 0 1-1.5-1.4l-.47-7.14h-.33a.75.75 0 0 1 0-1.5h2.13l.12-.6Zm1.5 2.8a.6.6 0 0 0-.6.6v4.3a.6.6 0 1 0 1.2 0v-4.3a.6.6 0 0 0-.6-.6Zm-1.95.6a.6.6 0 1 1 1.2 0v4.3a.6.6 0 0 1-1.2 0v-4.3Zm4.75-.6a.6.6 0 0 0-.6.6v4.3a.6.6 0 1 0 1.2 0v-4.3a.6.6 0 0 0-.6-.6Z"
        fill="currentColor"
      />
    </svg>
  )
}

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
              {command.title}
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
              <PinIcon />
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
              <StepsIcon />
            </button>
            <button
              type="button"
              className="solid icon-button run-button"
              aria-label={`Run ${command.title}`}
              title="Run command"
              onClick={() => runCommand(command.id)}
            >
              <PlayIcon />
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
                <RemoveIcon />
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
                          <ArrowUpIcon />
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
                          <ArrowDownIcon />
                        </button>
                        <button
                          type="button"
                          className="sidebar-row-action danger"
                          title="Remove step"
                          onClick={() => {
                            setDraftPrerequisiteIds((current) => current.filter((item) => item !== prerequisiteId))
                          }}
                        >
                          <RemoveIcon />
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
                  <AddIcon />
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
                  <CheckIcon />
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
                    <ClearIcon />
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
                  <RemoveIcon />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
