import { useEffect, useMemo, useState } from 'react'
import { Clock, Trash2 } from 'lucide-react'
import type { GitWorktree, WorkspaceRecord } from '@shared/types'
import {
  DEFAULT_WORKTREE_CLEANUP_MAX_AGE_DAYS,
  WORKTREE_CLEANUP_AGE_OPTIONS,
  normalizeWorktreeCleanupMaxAgeDays,
  selectWorktreesForCleanup,
  worktreeCleanupReasonLabel,
  type WorktreeCleanupAgeDays
} from '@shared/worktreeCleanup'
import { worktreeLabel } from '@shared/worktreeExecution'
import { useAppStore } from '@renderer/store/useAppStore'

const SETTINGS_KEY = 'workspace-manager.worktree-cleanup'

interface WorktreeCleanupSettings {
  maxAgeDays: WorktreeCleanupAgeDays
  includeDirty: boolean
}

export function readWorktreeCleanupSettings(): WorktreeCleanupSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { maxAgeDays: DEFAULT_WORKTREE_CLEANUP_MAX_AGE_DAYS, includeDirty: false }
    const parsed = JSON.parse(raw) as Partial<WorktreeCleanupSettings>
    return {
      maxAgeDays: normalizeWorktreeCleanupMaxAgeDays(parsed.maxAgeDays),
      includeDirty: Boolean(parsed.includeDirty)
    }
  } catch {
    return { maxAgeDays: DEFAULT_WORKTREE_CLEANUP_MAX_AGE_DAYS, includeDirty: false }
  }
}

function writeWorktreeCleanupSettings(settings: WorktreeCleanupSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface WorktreeCleanupPanelProps {
  workspace: WorkspaceRecord
  busy: boolean
  protectPaths: string[]
  onBusy: (action: () => Promise<void>) => Promise<void>
}

export function WorktreeCleanupPanel({ workspace, busy, protectPaths, onBusy }: WorktreeCleanupPanelProps) {
  const cleanupGitWorktrees = useAppStore((state) => state.cleanupGitWorktrees)
  const [settings, setSettings] = useState<WorktreeCleanupSettings>(() => readWorktreeCleanupSettings())
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  const matches = useMemo(
    () =>
      selectWorktreesForCleanup(workspace.gitWorktrees ?? [], {
        maxAgeDays: settings.maxAgeDays,
        includeDirty: settings.includeDirty,
        protectPaths
      }),
    [workspace.gitWorktrees, protectPaths, settings.includeDirty, settings.maxAgeDays]
  )

  const matchPathsKey = matches.map((entry) => entry.worktree.path).join('\0')

  useEffect(() => {
    writeWorktreeCleanupSettings(settings)
  }, [settings])

  useEffect(() => {
    setSelectedPaths(matchPathsKey ? matchPathsKey.split('\0') : [])
  }, [matchPathsKey])

  const selectedCount = matches.filter((entry) => selectedPaths.includes(entry.worktree.path)).length

  function togglePath(path: string) {
    setSelectedPaths((current) =>
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]
    )
  }

  async function removeSelected() {
    const worktreePaths = matches
      .map((entry) => entry.worktree.path)
      .filter((path) => selectedPaths.includes(path))
    if (worktreePaths.length === 0) return

    await onBusy(async () => {
      const removed = await cleanupGitWorktrees({
        workspaceId: workspace.id,
        maxAgeDays: settings.maxAgeDays,
        includeDirty: settings.includeDirty,
        protectPaths,
        worktreePaths
      })
      const countLabel = removed.length === 1 ? 'Removed 1 checkout.' : `Removed ${removed.length} checkouts.`
      setResultMessage(countLabel)
    })
  }

  return (
    <section className="worktree-cleanup" aria-labelledby="worktree-cleanup-title">
      <div className="worktrees-dialog-section-head">
        <h3 id="worktree-cleanup-title">Cleanup</h3>
        <span className="workspace-meta-badge subtle">{matches.length} ready</span>
      </div>

      <p className="worktree-cleanup-copy">
        Remove linked checkouts that have sat idle. The main checkout, locked folders, and this workspace stay.
      </p>

      <fieldset className="worktree-cleanup-ages" disabled={busy}>
        <legend>Idle longer than</legend>
        <div role="radiogroup" aria-label="Idle longer than">
          {WORKTREE_CLEANUP_AGE_OPTIONS.map((days) => {
            const active = settings.maxAgeDays === days
            return (
              <button
                key={days}
                type="button"
                role="radio"
                aria-checked={active}
                className={`worktree-cleanup-age${active ? ' active' : ''}`}
                onClick={() => setSettings((current) => ({ ...current, maxAgeDays: days }))}
              >
                {days}d
              </button>
            )
          })}
        </div>
      </fieldset>

      <label className="worktree-checkbox">
        <input
          type="checkbox"
          checked={settings.includeDirty}
          disabled={busy}
          onChange={(event) =>
            setSettings((current) => ({ ...current, includeDirty: event.target.checked }))
          }
        />
        <span>Include checkouts with uncommitted changes</span>
      </label>

      {matches.length > 0 ? (
        <div className="worktree-cleanup-list">
          {matches.map((entry) => {
            const worktree: GitWorktree = entry.worktree
            const checked = selectedPaths.includes(worktree.path)
            return (
              <label key={worktree.path} className={`worktree-cleanup-row${checked ? ' selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() => togglePath(worktree.path)}
                />
                <span className="worktree-cleanup-row-copy">
                  <strong>{worktreeLabel(worktree)}</strong>
                  <span>
                    {worktree.lastActivityRelative
                      ? `${worktree.lastActivityRelative.replace(' ago', '')} idle`
                      : worktreeCleanupReasonLabel(entry.reason)}
                  </span>
                </span>
                {worktree.isDirty && <span className="workspace-meta-badge warning">dirty</span>}
                {worktree.isMissing && <span className="workspace-meta-badge warning">missing</span>}
              </label>
            )
          })}
        </div>
      ) : (
        <p className="worktrees-dialog-empty">
          Nothing is older than {settings.maxAgeDays} days right now.
        </p>
      )}

      <div className="worktree-cleanup-actions">
        <button
          type="button"
          className="danger"
          disabled={busy || selectedCount === 0}
          onClick={() => void removeSelected()}
        >
          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
          {selectedCount === 1 ? 'Remove 1 checkout' : `Remove ${selectedCount} checkouts`}
        </button>
        {resultMessage && (
          <p className="worktree-cleanup-result" role="status">
            <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
            {resultMessage}
          </p>
        )}
      </div>
    </section>
  )
}
