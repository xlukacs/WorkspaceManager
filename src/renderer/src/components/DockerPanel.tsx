import React, { useEffect, useMemo, useState } from 'react'
import type { DockerCommandDescriptor, WorkspaceRecord } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { PrerequisiteSelect } from '@renderer/components/commandGroups'

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

function prerequisiteSummary(command: DockerCommandDescriptor) {
  if (command.prerequisiteTitles.length === 0) return null
  if (command.prerequisiteTitles.length === 1) return `Pre: ${command.prerequisiteTitles[0]}`
  return `${command.prerequisiteTitles.length} steps before run`
}

function uniqueCommands(commands: DockerCommandDescriptor[]) {
  return commands.filter((command, index, values) => values.findIndex((item) => item.id === command.id) === index)
}

export function DockerPanel({ workspace }: { workspace: WorkspaceRecord }) {
  const dockerList = useAppStore((state) => state.dockerLists[workspace.id])
  const commandList = useAppStore((state) => state.commandLists[workspace.id])
  const runDockerCommand = useAppStore((state) => state.runDockerCommand)
  const setCommandChain = useAppStore((state) => state.setCommandChain)
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null)
  const [draftPrerequisiteIds, setDraftPrerequisiteIds] = useState<string[]>([])
  const [pendingAddId, setPendingAddId] = useState('')

  const allCommands = useMemo(
    () => uniqueCommands([
      ...(dockerList?.groups.flatMap((group) => group.commands) ?? []),
      ...(commandList?.groups.flatMap((group) => group.commands).map((command) => ({ ...command, shellLine: command.script, description: command.script })) ?? [])
    ]),
    [dockerList, commandList]
  )
  const commandIndex = useMemo(
    () => new Map(allCommands.map((command) => [command.id, command])),
    [allCommands]
  )
  const editingCommand = editingCommandId ? commandIndex.get(editingCommandId) ?? null : null
  // The full command list holds every kind (scripts, Docker helpers, Run actions) grouped by project.
  const prerequisiteGroups = useMemo(
    () => commandList?.groups ?? dockerList?.groups.map((group) => ({
      ...group,
      commands: group.commands.map((command) => ({
        ...command, kind: 'docker' as const, scope: 'root' as const, name: command.title, script: command.shellLine,
        packageManager: 'unknown' as const, favorite: false
      }))
    })) ?? [],
    [commandList, dockerList]
  )

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

  if (!dockerList) {
    return <p className="muted">Loading Docker commands…</p>
  }

  if (dockerList.groups.length === 0) {
    return <p className="muted">{workspace.projects.some((project) => project.docker) ? 'Docker config is present, but no runnable commands were inferred yet.' : 'No Docker config detected. Add a compose file or Dockerfile.'}</p>
  }

  function startEditing(command: DockerCommandDescriptor) {
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

  function renderCommand(command: DockerCommandDescriptor) {
    const summary = prerequisiteSummary(command)

    return (
      <article key={command.id} className={`command-card docker-card ${editingCommandId === command.id ? 'editing' : ''}`}>
        <div className="command-row docker-row">
          <div className="command-copy">
            <strong title={command.title}>{command.title}</strong>
            <span title={command.description}>{command.description}</span>
            {summary && (
              <small className="command-summary" title={command.prerequisiteTitles.join(' -> ')}>
                {summary}
              </small>
            )}
          </div>
          <div className="command-actions">
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
              title={command.shellLine}
              onClick={() => runDockerCommand(command.id)}
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
        {dockerList.groups.map((group) => (
          <div key={group.key} className="command-group">
            <p className="group-label">{group.title}</p>
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
          <section className="command-chain-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="command-chain-dialog-head">
              <div>
                <p className="group-label">Docker Steps</p>
                <h3>{editingCommand.title}</h3>
                <span>{editingCommand.shellLine}</span>
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
              <p>Run these steps first, in order. The target command starts only after every prerequisite succeeds.</p>
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
                        <span>{prerequisite.description}</span>
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
                  groups={prerequisiteGroups}
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
                    onClick={() => setDraftPrerequisiteIds([])}
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
