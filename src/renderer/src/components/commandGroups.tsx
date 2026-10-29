import type { CommandDescriptor, CommandGroup, CommandKind, ProjectCapability } from '@shared/types'

const CAPABILITY_LABELS: Record<ProjectCapability, string> = {
  node: 'Node',
  python: 'Python',
  docker: 'Docker'
}

const KIND_LABELS: Partial<Record<CommandKind, string>> = {
  docker: 'Docker',
  'run-action': 'Run action'
}

/** Short label for non-script commands, which share project groups with scripts. */
export function commandKindLabel(command: Pick<CommandDescriptor, 'kind'>) {
  return command.kind ? KIND_LABELS[command.kind] ?? null : null
}

export function projectPathLabel(relativePath: string | undefined) {
  return relativePath ? relativePath : 'workspace root'
}

/** True when the query matches the group's project name or folder, so its whole group is shown. */
export function groupMatchesSearch(group: CommandGroup, query: string) {
  return [group.title, group.relativePath ?? ''].join(' ').toLowerCase().includes(query)
}

export function CommandGroupHeader({ group }: { group: CommandGroup }) {
  return (
    <div className="command-group-head">
      <p className="group-label">{group.title}</p>
      {group.projectId !== undefined && (
        <span className="command-group-path" title={group.relativePath || undefined}>
          {projectPathLabel(group.relativePath)}
        </span>
      )}
      {group.capabilities && group.capabilities.length > 0 && (
        <span className="capability-badges" aria-label={`Capabilities: ${group.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(', ')}`}>
          {group.capabilities.map((capability) => (
            <span key={capability} className={`capability-badge capability-${capability}`}>{CAPABILITY_LABELS[capability]}</span>
          ))}
        </span>
      )}
    </div>
  )
}

/**
 * Prerequisite picker shared by the Scripts and Docker panels: every command of every kind,
 * grouped by detected project so same-named scripts in different projects stay distinguishable.
 */
export function PrerequisiteSelect({
  groups,
  excludeIds,
  value,
  onChange
}: {
  groups: CommandGroup[]
  excludeIds: string[]
  value: string
  onChange: (commandId: string) => void
}) {
  const excluded = new Set(excludeIds)
  const seen = new Set<string>()
  return (
    <select aria-label="Prerequisite command" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Add prerequisite…</option>
      {groups.map((group) => {
        const options = group.commands.filter((command) => !excluded.has(command.id) && !seen.has(command.id))
        options.forEach((command) => seen.add(command.id))
        if (options.length === 0) return null
        const label = group.projectId !== undefined ? `${group.title} (${projectPathLabel(group.relativePath)})` : group.title
        return (
          <optgroup key={group.key} label={label}>
            {options.map((command) => {
              const kind = commandKindLabel(command)
              return (
                <option key={command.id} value={command.id}>
                  {kind ? `${command.name} · ${kind}` : command.name}
                </option>
              )
            })}
          </optgroup>
        )
      })}
    </select>
  )
}
