import { useEffect, useMemo, useState } from 'react'
import { Clock, Loader2, Trash2, X } from 'lucide-react'
import type { GitWorktree, WorkspaceRecord } from '@shared/types'
import {
  DEFAULT_WORKTREE_CLEANUP_MAX_AGE_DAYS,
  WORKTREE_CLEANUP_AGE_OPTIONS,
  estimateWorktreeCleanupRemainingMs,
  formatWorktreeCleanupEta,
  normalizeWorktreeCleanupMaxAgeDays,
  selectWorktreesForCleanup,
  worktreeCleanupReasonLabel,
  type WorktreeCleanupAgeDays,
  type WorktreeCleanupJob
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

function countLabel(count: number) {
  return count === 1 ? '1 checkout' : `${count} checkouts`
}

function formatElapsed(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 > 0 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function CleanupProgress({ job, labelFor }: { job: WorktreeCleanupJob; labelFor: (path: string) => string }) {
  const now = useNow()
  const preparing = job.removalStartedAt == null
  const finishing = !preparing && job.completed >= job.total
  const percent = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 100
  const eta = finishing ? 'Finishing up…' : formatWorktreeCleanupEta(estimateWorktreeCleanupRemainingMs(job, now))

  return (
    <div className="worktree-cleanup-progress" role="status" aria-live="polite">
      <div className="worktree-cleanup-progress-head">
        <Loader2 size={14} strokeWidth={1.75} className="spin" aria-hidden="true" />
        <strong>
          {preparing ? 'Checking checkouts…' : `${job.completed} of ${job.total} done`}
        </strong>
        {!preparing && <span>{eta}</span>}
      </div>
      <div
        className={`worktree-cleanup-progress-bar${preparing ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={preparing ? undefined : job.completed}
        aria-label="Cleanup progress"
      >
        <span style={preparing ? undefined : { width: `${percent}%` }} />
      </div>
      {job.activePaths.length > 0 && (
        <p className="worktree-cleanup-progress-active" title={job.activePaths.join('\n')}>
          Removing {job.activePaths.map(labelFor).join(', ')}
        </p>
      )}
      <p className="worktree-cleanup-progress-note">You can close this dialog. Cleanup keeps running.</p>
    </div>
  )
}

interface WorktreeCleanupPanelProps {
  workspace: WorkspaceRecord
  busy: boolean
  protectPaths: string[]
}

export function WorktreeCleanupPanel({ workspace, busy: dialogBusy, protectPaths }: WorktreeCleanupPanelProps) {
  const cleanupGitWorktrees = useAppStore((state) => state.cleanupGitWorktrees)
  const dismissWorktreeCleanupJob = useAppStore((state) => state.dismissWorktreeCleanupJob)
  const job = useAppStore((state) => state.worktreeCleanupJobs[workspace.id])
  const running = job?.status === 'running'
  const busy = dialogBusy || running
  const [settings, setSettings] = useState<WorktreeCleanupSettings>(() => readWorktreeCleanupSettings())
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])

  function labelFor(path: string) {
    const worktree = workspace.gitWorktrees?.find((entry) => entry.path === path)
    return worktreeLabel(worktree ?? { path, branch: null } as GitWorktree)
  }

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

  function removeSelected() {
    const worktreePaths = matches
      .map((entry) => entry.worktree.path)
      .filter((path) => selectedPaths.includes(path))
    if (worktreePaths.length === 0 || running) return

    // Runs in the store, so it keeps going after the dialog closes.
    void cleanupGitWorktrees({
      workspaceId: workspace.id,
      maxAgeDays: settings.maxAgeDays,
      includeDirty: settings.includeDirty,
      protectPaths,
      worktreePaths
    }).catch(() => {
      // The job and lastActionError carry the failure.
    })
  }

  return (
    <section className="worktree-cleanup" aria-labelledby="worktree-cleanup-title">
      <div className="worktrees-dialog-section-head">
        <h3 id="worktree-cleanup-title">Cleanup</h3>
        <span className="workspace-meta-badge subtle">
          {running ? 'Running' : `${matches.length} ready`}
        </span>
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

      {running ? (
        <CleanupProgress job={job} labelFor={labelFor} />
      ) : matches.length > 0 ? (
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
          onClick={removeSelected}
        >
          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
          {running ? 'Removing…' : `Remove ${countLabel(selectedCount)}`}
        </button>
        {job && !running && (
          <p className={`worktree-cleanup-result${job.errors.length > 0 ? ' has-errors' : ''}`} role="status">
            <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>
              {job.status === 'failed' ? 'Cleanup failed.' : `Removed ${countLabel(job.removedPaths.length)}.`}
              {job.status === 'done' && job.errors.length > 0 && ` ${countLabel(job.errors.length)} could not be removed.`}
              {job.finishedAt != null && ` Took ${formatElapsed(job.finishedAt - job.startedAt)}.`}
            </span>
            <button
              type="button"
              className="sidebar-row-action"
              aria-label="Dismiss cleanup result"
              title="Dismiss"
              onClick={() => dismissWorktreeCleanupJob(workspace.id)}
            >
              <X size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </p>
        )}
      </div>
    </section>
  )
}
