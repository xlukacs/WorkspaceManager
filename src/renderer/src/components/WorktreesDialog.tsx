import { useEffect, useMemo, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { EditorTarget, GitWorktree } from '@shared/types'
import { worktreeRemoveBlockReason } from '@shared/worktreeCleanup'
import { worktreeLabel } from '@shared/worktreeExecution'
import { WorktreeCleanupPanel } from '@renderer/components/WorktreeCleanupPanel'
import { useAppStore } from '@renderer/store/useAppStore'

function pathBasename(targetPath: string) {
  const normalized = targetPath.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/)
  return segments[segments.length - 1] || targetPath
}

function normalizeComparePath(targetPath: string) {
  return targetPath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

function defaultWorktreesRootPreview(workspaceRootPath: string) {
  const normalized = workspaceRootPath.replace(/[\\/]+$/, '')
  return `${normalized}\\.worktrees`
}

interface WorktreesDialogProps {
  workspaceId: string
  open: boolean
  onClose: () => void
}

export function WorktreesDialog({ workspaceId, open, onClose }: WorktreesDialogProps) {
  const workspaces = useAppStore((state) => state.workspaces)
  const importWorkspacePaths = useAppStore((state) => state.importWorkspacePaths)
  const convertRepoToWorktrees = useAppStore((state) => state.convertRepoToWorktrees)
  const createGitWorktree = useAppStore((state) => state.createGitWorktree)
  const importAllGitWorktrees = useAppStore((state) => state.importAllGitWorktrees)
  const removeGitWorktree = useAppStore((state) => state.removeGitWorktree)
  const rescanWorkspace = useAppStore((state) => state.rescanWorkspace)
  const lastActionError = useAppStore((state) => state.lastActionError)
  const clearActionError = useAppStore((state) => state.clearActionError)
  const selectedWorktreePath = useAppStore((state) => state.getSelectedWorktreePath(workspaceId))

  const workspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [workspaceId, workspaces]
  )

  const linkedWorkspacePaths = useMemo(
    () => new Set(workspaces.map((entry) => normalizeComparePath(entry.rootPath))),
    [workspaces]
  )

  const [branchName, setBranchName] = useState('')
  const [createBranch, setCreateBranch] = useState(true)
  const [busy, setBusy] = useState(false)

  const hasGit = Boolean(workspace?.gitSummary) || Boolean(workspace?.gitWorktreesRoot) || (workspace?.gitWorktrees ?? []).length > 0
  const worktrees = (workspace?.gitWorktrees ?? []).filter((worktree) => !worktree.isBare)
  const isWorktreeLayout = Boolean(workspace?.gitWorktreesRoot)
  const protectPaths = workspace
    ? [workspace.rootPath, selectedWorktreePath].filter((value): value is string => Boolean(value))
    : []
  const pendingImports = worktrees.filter((worktree) => {
    if (!workspace) return false
    const isCurrentRoot = normalizeComparePath(worktree.path) === normalizeComparePath(workspace.rootPath)
    return !isCurrentRoot && !linkedWorkspacePaths.has(normalizeComparePath(worktree.path))
  })

  useEffect(() => {
    if (!open) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [busy, onClose, open])

  useEffect(() => {
    if (!open) return
    clearActionError()
  }, [clearActionError, open])

  useEffect(() => {
    if (!open || !workspace) return
    void rescanWorkspace(workspace.id)
  }, [open, workspace?.id, rescanWorkspace])

  if (!open || !workspace || !hasGit) return null

  async function openWorktree(worktree: GitWorktree, editor?: EditorTarget) {
    if (editor) {
      await window.workspaceApi.system.openInEditor(worktree.path, editor)
      return
    }
    await window.workspaceApi.system.openPath(worktree.path)
  }

  async function runWorktreeAction(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch {
      // Surface the failure through lastActionError in the dialog.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="worktrees-dialog-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="worktrees-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktrees-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="worktrees-dialog-head">
          <div>
            <p className="eyebrow">Git worktrees</p>
            <h2 id="worktrees-dialog-title">{workspace.name}</h2>
            <p className="worktrees-dialog-subtitle">{workspace.rootPath}</p>
          </div>
          <button
            type="button"
            className="sidebar-row-action"
            title="Close"
            aria-label="Close worktrees dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="worktrees-dialog-body">
          {lastActionError && (
            <p className="worktrees-dialog-error" role="alert">
              {lastActionError}
            </p>
          )}
          {!isWorktreeLayout ? (
            <section className="worktree-setup worktree-setup-dialog">
              <h3>Set up worktrees</h3>
              <p>
                Create a <strong>.worktrees</strong> folder in this repo for parallel branch checkouts.
                Workspace Manager will add <strong>.worktrees/</strong> to <strong>.gitignore</strong>.
              </p>
              <p className="worktree-setup-path">{defaultWorktreesRootPreview(workspace.rootPath)}</p>
              <button
                type="button"
                className="solid"
                disabled={busy}
                onClick={() => runWorktreeAction(() => convertRepoToWorktrees(workspace.id))}
              >
                Convert repo to worktrees
              </button>
            </section>
          ) : (
            <>
              <section className="worktrees-dialog-section">
                <div className="worktrees-dialog-section-head">
                  <h3>Worktrees root</h3>
                  <span className="workspace-meta-badge subtle">{worktrees.length} linked</span>
                </div>
                <p className="worktree-root-label">{workspace.gitWorktreesRoot}</p>
              </section>

              <section className="worktrees-dialog-section">
                <h3>Create worktree</h3>
                <form
                  className="worktree-form worktree-form-dialog"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!branchName.trim()) return
                    void runWorktreeAction(async () => {
                      await createGitWorktree(workspace.id, branchName.trim(), createBranch)
                      setBranchName('')
                    })
                  }}
                >
                  <label className="worktree-field">
                    <span>Branch name</span>
                    <input
                      value={branchName}
                      onChange={(event) => setBranchName(event.target.value)}
                      placeholder="feature/my-branch"
                      disabled={busy}
                    />
                  </label>
                  <label className="worktree-checkbox">
                    <input
                      type="checkbox"
                      checked={createBranch}
                      onChange={(event) => setCreateBranch(event.target.checked)}
                      disabled={busy}
                    />
                    <span>Create branch if it does not exist</span>
                  </label>
                  <div className="worktrees-dialog-form-actions">
                    <button type="submit" className="solid" disabled={busy || !branchName.trim()}>
                      Add worktree
                    </button>
                    {pendingImports.length > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runWorktreeAction(() => importAllGitWorktrees(workspace.id))}
                      >
                        Import all as workspaces ({pendingImports.length})
                      </button>
                    )}
                  </div>
                </form>
              </section>
            </>
          )}

          <WorktreeCleanupPanel
            workspace={workspace}
            busy={busy}
            protectPaths={protectPaths}
            onBusy={runWorktreeAction}
          />

          <section className="worktrees-dialog-section">
            <div className="worktrees-dialog-section-head">
              <h3>Checkouts</h3>
              <div className="worktrees-dialog-form-actions">
                {!isWorktreeLayout && (
                  <span className="workspace-meta-badge subtle">{worktrees.length} linked</span>
                )}
                {pendingImports.length > 0 && !isWorktreeLayout && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runWorktreeAction(() => importAllGitWorktrees(workspace.id))}
                  >
                    Import all as workspaces ({pendingImports.length})
                  </button>
                )}
              </div>
            </div>
            {worktrees.length > 0 ? (
              <div className="worktree-list worktree-list-dialog">
                {worktrees.map((worktree) => {
                  const isCurrentRoot = normalizeComparePath(worktree.path) === normalizeComparePath(workspace.rootPath)
                  const isImported = linkedWorkspacePaths.has(normalizeComparePath(worktree.path))
                  const label = worktree.branch ?? pathBasename(worktree.path)
                  const removeBlock = worktreeRemoveBlockReason(worktree, [workspace.rootPath])

                  return (
                    <article
                      key={worktree.path}
                      className={`worktree-row worktree-row-dialog${isCurrentRoot ? ' current' : ''}${worktree.isLocked ? ' locked' : ''}`}
                    >
                      <div className="worktree-row-main">
                        <div>
                          <strong title={label}>{label}</strong>
                          <span title={worktree.path}>{worktree.path}</span>
                        </div>
                        <div className="worktree-badges">
                          {worktree.isMain && <span className="workspace-meta-badge subtle">main</span>}
                          {isCurrentRoot && <span className="workspace-meta-badge git">active workspace</span>}
                          {worktree.isLocked && <span className="workspace-meta-badge warning">locked</span>}
                          {worktree.isDirty && <span className="workspace-meta-badge warning">dirty</span>}
                          {worktree.isMissing && <span className="workspace-meta-badge warning">missing</span>}
                          {worktree.lastActivityRelative && (
                            <span className="workspace-meta-badge subtle">{worktree.lastActivityRelative}</span>
                          )}
                          {isImported && !isCurrentRoot && (
                            <span className="workspace-meta-badge success">in sidebar</span>
                          )}
                        </div>
                      </div>
                      <div className="command-actions worktree-row-actions">
                        <button type="button" onClick={() => openWorktree(worktree, 'cursor')}>
                          Cursor
                        </button>
                        <button type="button" onClick={() => openWorktree(worktree)}>
                          Explorer
                        </button>
                        <button type="button" onClick={() => window.workspaceApi.system.openInTerminal(worktree.path)}>
                          Terminal
                        </button>
                        {!isImported && !isCurrentRoot && (
                          <button
                            type="button"
                            className="solid"
                            onClick={() => importWorkspacePaths([worktree.path], workspace.groupId)}
                          >
                            Add workspace
                          </button>
                        )}
                        <button
                          type="button"
                          className="danger"
                          title={removeBlock ?? `Remove ${worktreeLabel(worktree)}`}
                          disabled={busy || Boolean(removeBlock)}
                          onClick={() => runWorktreeAction(() => removeGitWorktree(workspace.id, worktree.path))}
                        >
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <p className="worktrees-dialog-empty">
                {isWorktreeLayout
                  ? 'No worktrees detected yet. Create one above.'
                  : 'No extra checkouts in this repo yet.'}
              </p>
            )}
          </section>
        </div>

        <footer className="worktrees-dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
