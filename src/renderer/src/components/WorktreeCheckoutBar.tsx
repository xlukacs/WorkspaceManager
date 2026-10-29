import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, GitBranch, Search, X } from 'lucide-react'
import type { GitWorktree, WorkspaceRecord } from '@shared/types'
import {
  listWorkspaceWorktrees,
  normalizeComparePath,
  workspaceHasMultipleWorktrees,
  resolveSelectedWorktreePath,
  worktreeLabel
} from '@shared/worktreeExecution'
import {
  filterWorktrees,
  fitChipsInRow,
  prioritizeWorktrees,
  sortWorktreesByActivity
} from '@shared/worktreeCheckout'
import { useAppStore } from '@renderer/store/useAppStore'

interface WorktreeCheckoutBarProps {
  workspace: WorkspaceRecord
}

export function WorktreeCheckoutBar({ workspace }: WorktreeCheckoutBarProps) {
  const selectedWorktreePath = useAppStore((state) => state.getSelectedWorktreePath(workspace.id))
  const setSelectedWorktree = useAppStore((state) => state.setSelectedWorktree)
  const terminals = useAppStore((state) => state.terminals)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [fittedIndexes, setFittedIndexes] = useState<number[] | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)

  const worktrees = useMemo(() => listWorkspaceWorktrees(workspace), [workspace])
  const selectedKey = normalizeComparePath(selectedWorktreePath ?? workspace.rootPath)

  const runningKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const session of terminals) {
      if (session.workspaceId !== workspace.id || session.status !== 'running') continue
      keys.add(normalizeComparePath(resolveSelectedWorktreePath(workspace, session.worktreePath)))
    }
    return keys
  }, [terminals, workspace])

  const prioritized = useMemo(
    () =>
      prioritizeWorktrees(worktrees, {
        selectedPath: selectedWorktreePath ?? workspace.rootPath,
        activePaths: runningKeys
      }),
    [worktrees, selectedWorktreePath, workspace.rootPath, runningKeys]
  )
  // Pick by priority, but keep a stable main-then-recent order so chips don't jump when clicked.
  const featured = useMemo(() => {
    const shown = new Set((fittedIndexes ?? [0]).map((index) => prioritized[index]).filter(Boolean))
    return sortWorktreesByActivity(worktrees).filter((worktree) => shown.has(worktree))
  }, [fittedIndexes, prioritized, worktrees])
  const matches = useMemo(
    () => (expanded ? filterWorktrees(sortWorktreesByActivity(worktrees), query) : []),
    [expanded, worktrees, query]
  )

  useEffect(() => {
    setExpanded(false)
    setQuery('')
  }, [workspace.id])

  useEffect(() => {
    if (expanded) searchRef.current?.focus()
  }, [expanded])

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return

    const fit = () => {
      const chips = Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-chip]'))
      const overflow = measure.querySelector<HTMLElement>('[data-measure-overflow]')
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
      const next = fitChipsInRow(
        chips.map((chip) => chip.getBoundingClientRect().width),
        row.clientWidth,
        gap,
        overflow?.getBoundingClientRect().width ?? 0
      )
      setFittedIndexes((current) =>
        current && current.length === next.length && current.every((value, index) => value === next[index])
          ? current
          : next
      )
    }

    fit()
    let disposed = false
    // Chip widths change once the UI font finishes loading.
    void document.fonts?.ready.then(() => {
      if (!disposed) fit()
    })
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        disposed = true
      }
    }
    const observer = new ResizeObserver(fit)
    observer.observe(row)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [prioritized])

  const hasGit =
    Boolean(workspace.gitSummary) ||
    Boolean(workspace.gitWorktreesRoot) ||
    (workspace.gitWorktrees ?? []).length > 0

  if (!hasGit && !workspaceHasMultipleWorktrees(workspace)) {
    return null
  }

  const hiddenCount = worktrees.length - featured.length
  const showToggle = hiddenCount > 0 || expanded

  function collapse() {
    setExpanded(false)
    setQuery('')
  }

  function select(worktree: GitWorktree) {
    setSelectedWorktree(workspace.id, worktree.path)
    collapse()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && matches[0]) {
      event.preventDefault()
      select(matches[0])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (query) setQuery('')
      else collapse()
    }
  }

  function chipContent(worktree: GitWorktree, running: boolean) {
    return (
      <>
        {running && <span className="worktree-checkout-chip-running" aria-label="Console running" />}
        <span>{worktreeLabel(worktree)}</span>
        {worktree.isMain && <span className="worktree-checkout-chip-tag">main</span>}
      </>
    )
  }

  function renderChip(worktree: GitWorktree) {
    const key = normalizeComparePath(resolveSelectedWorktreePath(workspace, worktree.path))
    const active = key === selectedKey
    const running = runningKeys.has(key)
    const title = worktree.lastActivityRelative
      ? `${worktree.path}\nLast activity ${worktree.lastActivityRelative}`
      : worktree.path
    return (
      <button
        key={worktree.path}
        type="button"
        role="tab"
        aria-selected={active}
        className={`worktree-checkout-chip${active ? ' active' : ''}${worktree.isLocked ? ' locked' : ''}`}
        title={title}
        onClick={() => select(worktree)}
      >
        {chipContent(worktree, running)}
      </button>
    )
  }

  return (
    <div className="worktree-checkout">
      <div className="worktree-checkout-bar">
        <span className="worktree-checkout-label">
          <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
          Checkout
        </span>
        <div ref={rowRef} className="worktree-checkout-options" role="tablist" aria-label="Git worktree checkout">
          {featured.map(renderChip)}
          {showToggle && (
            <button
              type="button"
              className={`worktree-checkout-more${expanded ? ' open' : ''}`}
              aria-expanded={expanded}
              onClick={() => (expanded ? collapse() : setExpanded(true))}
            >
              {expanded ? (
                <>
                  Close
                  <ChevronUp size={13} aria-hidden="true" />
                </>
              ) : (
                <>
                  <Search size={12} aria-hidden="true" />
                  {hiddenCount} more
                  <ChevronDown size={13} aria-hidden="true" />
                </>
              )}
            </button>
          )}
        </div>
        <div ref={measureRef} className="worktree-checkout-measure" aria-hidden="true">
          {prioritized.map((worktree) => (
            <span key={worktree.path} data-measure-chip className="worktree-checkout-chip">
              {chipContent(worktree, runningKeys.has(normalizeComparePath(worktree.path)))}
            </span>
          ))}
          <span data-measure-overflow className="worktree-checkout-more">
            <Search size={12} />
            {worktrees.length} more
            <ChevronDown size={13} />
          </span>
        </div>
      </div>
      {expanded && (
        <div className="worktree-checkout-browser">
          <div className="worktree-checkout-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={`Search ${worktrees.length} checkouts by branch or path`}
              aria-label="Search checkouts"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <span className="worktree-checkout-search-count">
              {query ? `${matches.length} / ${worktrees.length}` : worktrees.length}
            </span>
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </div>
          {matches.length > 0 ? (
            <div className="worktree-checkout-results" role="tablist" aria-label="All checkouts">
              {matches.map(renderChip)}
            </div>
          ) : (
            <p className="worktree-checkout-empty">No checkouts match “{query}”.</p>
          )}
        </div>
      )}
    </div>
  )
}
