import { useEffect, useState } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'

export function ImportDrawer() {
  const importDrawerOpen = useAppStore((state) => state.importDrawerOpen)
  const importCandidates = useAppStore((state) => state.importCandidates)
  const groups = useAppStore((state) => state.groups)
  const selectedGroupId = useAppStore((state) => state.selectedGroupId)
  const dismissImportDrawer = useAppStore((state) => state.dismissImportDrawer)
  const applyImportSelection = useAppStore((state) => state.applyImportSelection)
  const [selectedIds, setSelectedIds] = useState<string[]>(importCandidates.map((candidate) => candidate.rootPath))
  // '' is "No group": new workspaces go to the ungrouped section.
  const defaultGroupId = selectedGroupId !== 'all' && groups.some((group) => group.id === selectedGroupId) ? selectedGroupId : ''
  const [groupId, setGroupId] = useState(defaultGroupId)

  useEffect(() => {
    setSelectedIds(importCandidates.map((candidate) => candidate.rootPath))
    setGroupId(defaultGroupId)
  }, [defaultGroupId, importCandidates])

  if (!importDrawerOpen) return null

  return (
    <div className="drawer-backdrop">
      <div className="drawer">
        <div className="section-head">
          <h2>Import candidates</h2>
          <span>{importCandidates.length} detected</span>
        </div>

        <label className="search">
          <span>Add to group</span>
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>

        <div className="candidate-list">
          {importCandidates.map((candidate) => (
            <label key={candidate.rootPath} className="candidate-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(candidate.rootPath)}
                onChange={(event) => {
                  setSelectedIds((current) => event.target.checked
                    ? [...current, candidate.rootPath]
                    : current.filter((id) => id !== candidate.rootPath))
                }}
              />
              <div>
                <strong>{candidate.name}</strong>
                <p>{candidate.rootPath}</p>
              </div>
              <span>
                {candidate.isGitWorktree ? 'worktree · ' : ''}
                {candidate.hasPackageJson ? 'pkg' : 'repo'} · {candidate.hasGit ? 'git' : 'no git'}
              </span>
            </label>
          ))}
        </div>

        <div className="drawer-actions">
          <button type="button" onClick={dismissImportDrawer}>
            Cancel
          </button>
          <button
            type="button"
            className="solid"
            onClick={() => applyImportSelection(selectedIds, groupId || null).then(() => setSelectedIds([]))}
          >
            Import selected
          </button>
        </div>
      </div>
    </div>
  )
}
