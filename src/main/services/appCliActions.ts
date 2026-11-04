import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AppCliRequest } from '@shared/appCli'
import type { AppStore } from '@main/store'
import type { TerminalManager } from './terminalManager'
import type { TerminalSession, WorkspaceRecord } from '@shared/types'
import { findWorkspace, resolveRunnable, type AgentCatalog } from '@agent/catalog'
import { normalizeComparePath } from '@shared/worktreeExecution'
import { refreshWorkspace, scanWorkspace } from './workspaceScan'
import { resolveGitCheckout } from './git'
import { WorkspaceLeases } from './workspaceLeases'
import { DEFAULT_RUN_TIMEOUT_MS, executeRunPlan } from '@agent/runCommand'

export type AppCliStore = Pick<AppStore, 'getGroups' | 'setGroups' | 'getWorkspaceRecords' | 'upsertWorkspaceRecord' | 'getUiState' | 'setUiState' | 'getPreferredShell'> & Partial<Pick<AppStore, 'getSettings'>>
export function createAppCliHandler(deps: {
  store: AppCliStore
  terminals: TerminalManager
  runStoredCommand: (input: { commandId: string; worktreePath?: string | null }) => Promise<TerminalSession>
  changed: (sessionId?: string) => void
  focus: () => void
}) {
  const { store, terminals } = deps
  const catalog = (): AgentCatalog => ({ storePath: '', groups: store.getGroups(), workspaces: store.getWorkspaceRecords(), terminals: terminals.list(), preferredShell: store.getPreferredShell() })
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
  /** `listed` is false when git found a worktree the stored list does not have yet. */
  type CheckoutMatch = { workspace: WorkspaceRecord; checkout: string; listed: boolean }
  /** The registered root or known worktree that contains the path, deepest first. */
  const knownCheckout = (path: string): CheckoutMatch | undefined => {
    const target = normalizeComparePath(path)
    return store.getWorkspaceRecords().flatMap((workspace) => [workspace.rootPath, ...workspace.gitWorktrees.filter((tree) => !tree.isBare && !tree.isMissing).map((tree) => tree.path)]
      .map((checkout) => ({ workspace, checkout, base: normalizeComparePath(checkout), listed: true })))
      .filter(({ base }) => target === base || target.startsWith(base + '/'))
      .sort((a, b) => b.base.length - a.base.length)
      .map(({ workspace, checkout, listed }) => ({ workspace, checkout, listed }))[0]
  }
  /**
   * An agent's new worktree is not in the stored worktree list yet. git lists
   * every checkout of its repository, so the owner is the workspace rooted at
   * one of them. A monorepo package workspace is rooted below its checkout,
   * so it never claims sibling packages. Prefer the main checkout, which git
   * lists first, over worktrees that were added as workspaces of their own.
   */
  const gitOwner = (git: { topLevel: string; checkouts: string[] }): CheckoutMatch | undefined => {
    const rank = new Map(git.checkouts.map((checkout, index) => [normalizeComparePath(checkout), index]))
    const workspace = store.getWorkspaceRecords()
      .filter((entry) => rank.has(normalizeComparePath(entry.rootPath)))
      .sort((a, b) => rank.get(normalizeComparePath(a.rootPath))! - rank.get(normalizeComparePath(b.rootPath))!)[0]
    return workspace ? { workspace, checkout: git.topLevel, listed: false } : undefined
  }
  const checkoutFor = async (path: string): Promise<CheckoutMatch | undefined> => {
    const known = knownCheckout(path)
    if (known && normalizeComparePath(known.checkout) === normalizeComparePath(path)) return known
    // A new worktree can sit inside a known checkout (for example <root>/.worktrees/x).
    const git = await resolveGitCheckout(path)
    if (!git || (known && normalizeComparePath(git.topLevel).length <= normalizeComparePath(known.checkout).length)) return known
    return gitOwner(git) ?? known
  }
  /** git lists the main checkout (or the bare repository) first. */
  const isMainCheckout = async (checkout: string) => {
    const git = await resolveGitCheckout(checkout)
    return git?.checkouts[0] !== undefined && normalizeComparePath(git.checkouts[0]) === normalizeComparePath(git.topLevel)
  }
  /** targets() and perform() both need the cwd's checkout, so look it up once per request. */
  const cwdLookups = new WeakMap<AppCliRequest, Promise<CheckoutMatch | undefined>>()
  const cwdCheckout = (request: AppCliRequest) => {
    let lookup = cwdLookups.get(request)
    if (!lookup) {
      lookup = checkoutFor(realpathSync(resolve(request.cwd!)))
      cwdLookups.set(request, lookup)
    }
    return lookup
  }
  /** Rescan so the new worktree shows up in the app's checkout bar. */
  const refreshWorktrees = async (workspace: WorkspaceRecord) => {
    try {
      return await refreshWorkspace({
        getWorkspaceRecords: () => store.getWorkspaceRecords(),
        getWorkspaceRecord: (id) => store.getWorkspaceRecords().find((entry) => entry.id === id) ?? null,
        upsertWorkspaceRecord: (record) => store.upsertWorkspaceRecord(record)
      }, workspace.id) ?? workspace
    } catch {
      return workspace
    }
  }
  const group = (query: string) => {
    const matches = store.getGroups().filter((entry) => entry.id === query || entry.name.toLowerCase() === query.toLowerCase())
    if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous group: ${query}` : `Unknown group: ${query}`)
    return matches[0]
  }
  const select = (workspaceId: string, session?: TerminalSession) => {
    const workspace = store.getWorkspaceRecords().find((entry) => entry.id === workspaceId)!
    const ui = store.getUiState()
    store.setUiState({ ...ui, selectedWorkspaceId: workspaceId, selectedGroupId: workspace.groupId ?? 'all',
      selectedWorktreeByWorkspace: session?.worktreePath ? { ...ui.selectedWorktreeByWorkspace, [workspaceId]: session.worktreePath } : ui.selectedWorktreeByWorkspace })
  }
  /** Pass `owner` when the caller already looked up the containing checkout. */
  const add = async (path: string, request: AppCliRequest, owner?: CheckoutMatch | null) => {
    const rootPath = realpathSync(resolve(path))
    if (!statSync(rootPath).isDirectory()) throw new Error('Workspace path must be a directory.')
    const existing = store.getWorkspaceRecords().find((entry) => normalizeComparePath(entry.rootPath) === normalizeComparePath(rootPath))
    if (!existing) {
      // A linked worktree of a registered repository belongs to that workspace.
      // The main checkout still gets its own, even if a worktree was added first.
      if (owner === undefined) owner = await checkoutFor(rootPath)
      if (owner && normalizeComparePath(owner.checkout) !== normalizeComparePath(owner.workspace.rootPath)
        && !await isMainCheckout(owner.checkout)) {
        const workspace = await refreshWorktrees(owner.workspace)
        const ignored = (['name', 'group'] as const).filter((flag) => text(request[flag]))
        if (ignored.length === 0) return workspace
        const flags = ignored.map((flag) => `--${flag}`).join(' and ')
        return { ...workspace, warnings: [`${rootPath} is a worktree of "${workspace.name}", so it joined that workspace and ${flags} ${ignored.length > 1 ? 'were' : 'was'} not applied.`] }
      }
    }
    let groupId = existing?.groupId ?? null
    const groupName = text(request.group)
    if (groupName) {
      const matches = store.getGroups().filter((entry) => entry.id === groupName || entry.name.toLowerCase() === groupName.toLowerCase())
      if (matches.length > 1) throw new Error(`Ambiguous group: ${groupName}`)
      if (matches[0]) groupId = matches[0].id
      else {
        const groups = store.getGroups()
        groupId = `group-${randomUUID()}`
        store.setGroups([...groups, { id: groupId, name: groupName, color: null, order: Math.max(-1, ...groups.map((entry) => entry.order)) + 1 }])
      }
    }
    const scanned = await scanWorkspace(rootPath, groupId, existing ?? null)
    const name = text(request.name)
    const workspace = { ...scanned, groupId, ...(name ? { name, nameOverride: name } : {}),
      order: existing?.groupId === groupId ? existing.order : store.getWorkspaceRecords().filter((entry) => entry.id !== existing?.id && entry.groupId === groupId).length }
    store.upsertWorkspaceRecord(workspace)
    return workspace
  }
  const selectedWorkspaceIds = (request: AppCliRequest) => {
    if (text(request.workspace) && text(request.group)) throw new Error('Choose either --workspace or --group.')
    if (text(request.workspace)) return [findWorkspace(catalog(), request.workspace!).id]
    if (text(request.group)) {
      const id = group(request.group!).id
      return store.getWorkspaceRecords().filter((entry) => entry.groupId === id).map((entry) => entry.id)
    }
    throw new Error('Select --workspace or --group.')
  }
  const perform = async (request: AppCliRequest, signal: AbortSignal): Promise<unknown> => {
    if (request.action === 'ping') return { running: true }
    if (request.action === 'add') {
      const path = text(request.cwd)
      if (!path) throw new Error('A workspace path is required.')
      const workspace = await add(path, request, (await cwdCheckout(request)) ?? null)
      select(workspace.id); deps.changed()
      return workspace
    }
    if (request.action === 'run') {
      const resolved = resolveRunnable(catalog(), { project: request.workspace, command: request.command!, worktree: request.worktree })
      const timeoutMs = request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new Error('timeoutMs must be a non-negative integer.')
      const result = await executeRunPlan(resolved.plan, { preferredShell: store.getPreferredShell(),
        nodeCaCertificate: store.getSettings?.().nodeCaCertificate, timeoutMs, signal })
      return { project: { id: resolved.workspace.id, name: resolved.workspace.name, rootPath: resolved.workspace.rootPath },
        command: { id: resolved.command.id, title: resolved.command.title, kind: resolved.command.kind }, ...result }
    }
    if (request.action === 'start') {
      let session: TerminalSession
      if (text(request.cwd)) {
        const argv = request.argv
        if (!Array.isArray(argv) || !argv.length || argv.some((arg) => typeof arg !== 'string')) throw new Error('Pass a command after --.')
        const cwd = realpathSync(resolve(request.cwd!))
        if (!statSync(cwd).isDirectory()) throw new Error('cwd must be a directory.')
        let match = await cwdCheckout(request)
        // A lease wait can outlast the workspace that matched.
        if (match && !store.getWorkspaceRecords().some((entry) => entry.id === match!.workspace.id)) match = await checkoutFor(cwd)
        const workspace = !match ? await add(cwd, request, null)
          : match.listed ? match.workspace : await refreshWorktrees(match.workspace)
        const quote = (value: string) => process.platform === 'win32' && store.getPreferredShell() === 'cmd'
          ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`
        const shellLine = argv.length === 1 ? argv[0] : `${process.platform === 'win32' && store.getPreferredShell() !== 'cmd' ? '& ' : ''}${argv.map(quote).join(' ')}`
        const commandId = `${workspace.id}::custom::${randomUUID()}`
        const title = text(request.label) ?? shellLine
        session = await terminals.run({ workspaceId: workspace.id, projectId: null, commandId, title, worktreePath: match?.checkout ?? workspace.rootPath, shellLine,
          runPlan: { kind: 'single', commandId, title, shellLine, steps: [{ commandId, title, shellLine, cwd, pythonEnvironment: null }] } })
      } else {
        const command = text(request.command)
        if (!command) throw new Error('A stored command is required.')
        const resolved = resolveRunnable(catalog(), { project: text(request.workspace), command, worktree: text(request.worktree) })
        session = await deps.runStoredCommand({ commandId: resolved.command.id, worktreePath: request.worktree })
      }
      select(session.workspaceId, session); deps.changed(session.id)
      return { sessionId: session.id }
    }
    if (request.action === 'sessions') {
      const ids = text(request.workspace) || text(request.group) ? new Set(selectedWorkspaceIds(request)) : null
      return terminals.list().filter((session) => (!ids || ids.has(session.workspaceId)) && (!request.running || session.status === 'running'))
        .map(({ buffer: _buffer, ...summary }) => summary)
    }
    if (request.action === 'output') {
      const session = terminals.list().find((entry) => entry.id === text(request.sessionId))
      if (!session) throw new Error('Unknown session.')
      const limit = request.limitKb ?? 16
      if (!Number.isFinite(limit) || limit <= 0 || limit > 256) throw new Error('limitKb must be between 1 and 256.')
      return { sessionId: session.id, output: Buffer.from(session.buffer).subarray(-Math.floor(limit * 1024)).toString('utf8') }
    }
    if (request.action === 'focus') {
      const session = text(request.sessionId) ? terminals.list().find((entry) => entry.id === request.sessionId) : undefined
      if (text(request.sessionId) && !session) throw new Error('Unknown session.')
      const workspaceId = text(request.workspace) ? findWorkspace(catalog(), request.workspace!).id : session?.workspaceId
      if (session && workspaceId !== session.workspaceId) throw new Error('Session does not belong to the selected workspace.')
      if (workspaceId) select(workspaceId, session)
      deps.focus(); deps.changed(session?.id)
      return { focused: true }
    }
    if (['stop', 'pause', 'resume', 'kill-all'].includes(request.action)) {
      let result: unknown
      if (request.action === 'kill-all') result = await terminals.stopAll()
      else if (request.action === 'stop' && text(request.sessionId)) {
        if (text(request.workspace) || text(request.group)) throw new Error('Choose a session or a workspace/group.')
        result = await terminals.stop(request.sessionId!)
        if (!result) throw new Error('Unknown session.')
      } else {
        const ids = selectedWorkspaceIds(request)
        result = request.action === 'pause' ? await terminals.pauseGroup(ids)
          : request.action === 'resume' ? await terminals.resumeGroup(ids) : await terminals.stopGroup(ids)
      }
      deps.changed()
      // Output buffers are available separately, keeping list/control responses bounded.
      return Array.isArray(result) ? result.map((session: TerminalSession) => ({ sessionId: session.id, status: session.status }))
        : request.action === 'resume' ? { sessions: (result as { sessions: TerminalSession[] }).sessions.map((session) => ({ sessionId: session.id, status: session.status })), warnings: (result as { warnings: string[] }).warnings }
        : { stopped: true }
    }
    throw new Error(`Unknown app action: ${request.action}`)
  }

  const scopeOf = (workspace: { id: string; groupId: string | null }) => workspace.groupId ? `group:${workspace.groupId}` : `workspace:${workspace.id}`
  const leases = new WorkspaceLeases(async (ids, scope) => {
    const currentIds = store.getWorkspaceRecords().filter((workspace) => scopeOf(workspace) === scope).map((workspace) => workspace.id)
    await terminals.stopGroup([...new Set([...ids, ...currentIds])])
    deps.changed()
  })
  const scopeForGroup = (query: string) => `group:${group(query).id}`
  const addTargets = async (request: AppCliRequest): Promise<string[]> => {
    if (!text(request.cwd)) throw new Error('A workspace path is required.')
    const path = realpathSync(resolve(request.cwd!))
    const existing = store.getWorkspaceRecords().find((workspace) => normalizeComparePath(workspace.rootPath) === normalizeComparePath(path))
    const parent = (await cwdCheckout(request))?.workspace
    const scopes = existing ? [scopeOf(existing)] : parent ? [scopeOf(parent)] : []
    if (text(request.group)) {
      const matches = store.getGroups().filter((entry) => entry.id === request.group || entry.name.toLowerCase() === request.group!.toLowerCase())
      if (matches.length > 1) throw new Error(`Ambiguous group: ${request.group}`)
      scopes.push(matches[0] ? `group:${matches[0].id}` : `new-group:${request.group!.toLowerCase()}`)
    }
    return scopes.length ? scopes : [`path:${normalizeComparePath(path)}`]
  }
  const targets = async (request: AppCliRequest): Promise<string[]> => {
    if (text(request.workspace) && text(request.group)) throw new Error('Choose either --workspace or --group.')
    if (request.action === 'add') return addTargets(request)
    if (request.action === 'start' && text(request.cwd)) {
      const workspace = (await cwdCheckout(request))?.workspace
      return workspace ? [scopeOf(workspace)] : await addTargets(request)
    }
    if (request.action === 'start' || request.action === 'run') {
      const resolved = resolveRunnable(catalog(), { project: request.workspace, command: request.command ?? '', worktree: request.worktree })
      return [scopeOf(resolved.workspace)]
    }
    if (text(request.sessionId)) {
      const session = terminals.list().find((entry) => entry.id === request.sessionId)
      if (!session) throw new Error('Unknown session.')
      const workspace = store.getWorkspaceRecords().find((entry) => entry.id === session.workspaceId)
      if (!workspace) throw new Error('Unknown workspace for session.')
      // Include both targets before focus validates mismatched selectors.
      return [scopeOf(workspace), ...(text(request.workspace) ? [scopeOf(findWorkspace(catalog(), request.workspace!))] : [])]
    }
    if (request.action === 'kill-all' || (request.action === 'focus' && !text(request.workspace))) {
      return [...store.getWorkspaceRecords().map(scopeOf), ...store.getGroups().map((entry) => `group:${entry.id}`)]
    }
    if (text(request.group)) return [scopeForGroup(request.group!)]
    return selectedWorkspaceIds(request).map((id) => scopeOf(findWorkspace(catalog(), id)))
  }
  const handle = async (request: AppCliRequest, clientSignal?: AbortSignal): Promise<unknown> => {
    if (request.action === 'acquire') {
      const ids = selectedWorkspaceIds(request)
      const scope = text(request.group) ? scopeForGroup(request.group!) : scopeOf(findWorkspace(catalog(), ids[0]))
      const workspaceIds = store.getWorkspaceRecords().filter((workspace) => scopeOf(workspace) === scope).map((workspace) => workspace.id)
      return leases.acquire(scope, workspaceIds, request.leaseMs, text(request.label))
    }
    if (['lease-status', 'renew', 'release'].includes(request.action)) {
      if (!text(request.leaseId)) throw new Error('A lease ID is required.')
      return request.action === 'release' ? leases.release(request.leaseId!)
        : request.action === 'renew' ? leases.renew(request.leaseId!, request.leaseMs) : leases.status(request.leaseId!)
    }
    if (['ping', 'sessions', 'output'].includes(request.action)) return perform(request, new AbortController().signal)
    if (!['add', 'start', 'run', 'stop', 'pause', 'resume', 'kill-all', 'focus'].includes(request.action)) throw new Error(`Unknown app action: ${request.action}`)
    return leases.control(await targets(request), request.leaseId, (signal) => perform(request,
      request.action === 'run' && clientSignal ? AbortSignal.any([signal, clientSignal]) : signal))
  }
  return Object.assign(handle, { dispose: () => leases.dispose() })
}
