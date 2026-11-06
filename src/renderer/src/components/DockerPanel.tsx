import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ListOrdered,
  Play,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import type { DockerCommandDescriptor, WorkspaceRecord } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { PrerequisiteSelect } from '@renderer/components/commandGroups'

const iconProps = { strokeWidth: 1.75, 'aria-hidden': true as const }

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
              <ListOrdered {...iconProps} />
            </button>
            <button
              type="button"
              className="solid icon-button run-button"
              aria-label={`Run ${command.title}`}
              title={command.shellLine}
              onClick={() => runDockerCommand(command.id)}
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
        {dockerList.groups.map((group) => (
          <div key={group.key} className="command-group">
            <p className="command-group-title">{group.title}</p>
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
                <X {...iconProps} />
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
                    onClick={() => setDraftPrerequisiteIds([])}
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
