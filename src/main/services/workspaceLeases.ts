import { randomUUID } from 'node:crypto'
import { MAX_LEASE_MS, type WorkspaceLease } from '@shared/appCli'

type Entry = WorkspaceLease & { duration: number; timer?: ReturnType<typeof setTimeout> }

/** One FIFO per group (or ungrouped workspace). Tokens are private capabilities. */
export class WorkspaceLeases {
  private entries = new Map<string, Entry>()
  private queues = new Map<string, Entry[]>()
  private operations = new Map<string, Set<AbortController>>()
  private draining = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly stop: (workspaceIds: string[], scope: string) => Promise<unknown>) {}

  private duration(value: number | undefined) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_LEASE_MS) {
      throw new Error(`leaseMs must be an integer between 1 and ${MAX_LEASE_MS}.`)
    }
    return value
  }

  private view(entry: Entry): WorkspaceLease {
    const { duration: _duration, timer: _timer, ...lease } = entry
    const queue = this.queues.get(entry.scope) ?? []
    return { ...lease, workspaceIds: [...lease.workspaceIds], position: entry.state === 'queued' ? queue.filter((item) => item.state === 'queued').indexOf(entry) + 1 : 0 }
  }

  private get(id: string | undefined) {
    const entry = id && this.entries.get(id)
    if (!entry) throw new Error('Unknown lease. Acquire a new lease after an app restart.')
    return entry
  }

  private schedule(entry: Entry) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.state = 'expired'
      for (const controller of this.operations.get(entry.scope) ?? []) controller.abort()
      void this.advance(entry.scope).catch(() => { /* Keep the scope blocked if cleanup fails; the next request retries. */ })
    }, Math.max(1, entry.expiresAt! - Date.now()))
    entry.timer.unref()
  }

  private async advance(scope: string): Promise<void> {
    if (this.disposed) return
    const pending = this.draining.get(scope)
    if (pending) return pending
    const task = Promise.resolve().then(() => this.drain(scope))
    this.draining.set(scope, task)
    try { await task } finally { this.draining.delete(scope) }
  }

  private async drain(scope: string) {
    const queue = this.queues.get(scope)
    if (!queue) return
    while (queue.length && !this.operations.get(scope)?.size && !this.disposed) {
      const first = queue[0]
      if (first.state === 'started' && first.expiresAt! <= Date.now()) {
        first.state = 'expired'
      }
      if (first.state === 'released' || first.state === 'expired') {
        // A failed stop leaves the entry at the head, blocking the next agent.
        await this.stop(first.workspaceIds, scope)
        queue.shift()
        continue
      }
      if (first.state === 'started') return
      await this.stop(first.workspaceIds, scope)
      // A waiter may cancel while console cleanup is in progress.
      if (this.disposed) return
      if (queue[0] !== first || first.state !== 'queued') continue
      first.state = 'started'
      first.startedAt = Date.now()
      first.expiresAt = first.startedAt + first.duration
      this.schedule(first)
      return
    }
    if (!queue.length) this.queues.delete(scope)
  }

  async acquire(scope: string, workspaceIds: string[], duration: number | undefined, label?: string): Promise<WorkspaceLease> {
    if (this.disposed) throw new Error('Workspace Manager is shutting down.')
    const entry: Entry = {
      leaseId: randomUUID(), scope, workspaceIds: [...workspaceIds], label: label ?? null,
      duration: this.duration(duration), state: 'queued', position: 0,
      requestedAt: Date.now(), startedAt: null, expiresAt: null
    }
    this.entries.set(entry.leaseId, entry)
    const queue = this.queues.get(scope) ?? []
    queue.push(entry)
    this.queues.set(scope, queue)
    try { await this.advance(scope) }
    catch (error) {
      if (entry.state === 'queued') {
        const current = this.queues.get(scope)!
        current.splice(current.indexOf(entry), 1)
        this.entries.delete(entry.leaseId)
      }
      throw error
    }
    // Bound completed-token history without ever evicting a live reservation.
    if (this.entries.size > 1000) {
      for (const [id, item] of this.entries) {
        if ((item.state === 'released' || item.state === 'expired') && !this.queues.get(item.scope)?.includes(item)) this.entries.delete(id)
        if (this.entries.size <= 1000) break
      }
    }
    return this.view(entry)
  }

  async status(id: string) {
    const entry = this.get(id)
    await this.advance(entry.scope)
    return this.view(entry)
  }

  async renew(id: string, duration?: number) {
    const entry = this.get(id)
    await this.advance(entry.scope)
    if (entry.state !== 'started') throw new Error(`Cannot renew a ${entry.state} lease.`)
    entry.duration = this.duration(duration)
    // Renewal never moves the hard deadline beyond ten minutes from admission.
    entry.expiresAt = Math.min(Date.now() + entry.duration, entry.startedAt! + MAX_LEASE_MS)
    this.schedule(entry)
    return this.view(entry)
  }

  async release(id: string) {
    const entry = this.get(id)
    if (entry.state === 'queued') {
      const queue = this.queues.get(entry.scope)!
      queue.splice(queue.indexOf(entry), 1)
      entry.state = 'released'
    } else if (entry.state === 'started') {
      entry.state = 'released'
      if (entry.timer) clearTimeout(entry.timer)
      for (const controller of this.operations.get(entry.scope) ?? []) controller.abort()
    }
    await this.advance(entry.scope)
    return this.view(entry)
  }

  /** Authorize the complete target set before doing anything, then pin it through async work. */
  async control<T>(scopes: string[], id: string | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const targets = [...new Set(scopes)]
    for (const scope of targets) await this.advance(scope)
    const supplied = id ? this.get(id) : undefined
    if (supplied && (supplied.state !== 'started' || !targets.length || targets.some((scope) => scope !== supplied.scope))) {
      throw new Error('Lease is inactive or does not own every target. Use a workspace/group-scoped command.')
    }
    for (const scope of targets) {
      const head = this.queues.get(scope)?.[0]
      if (head && (head.state !== 'started' || head.leaseId !== id)) {
        throw new Error('Environment is locked or queued. Use acquire --wait, then pass --lease <id>.')
      }
      if (this.operations.get(scope)?.size) throw new Error('Another CLI operation controls this environment. Retry when it completes.')
    }
    const controller = new AbortController()
    for (const scope of targets) {
      const active = this.operations.get(scope) ?? new Set<AbortController>()
      active.add(controller)
      this.operations.set(scope, active)
    }
    try { return await action(controller.signal) }
    finally {
      for (const scope of targets) {
        this.operations.get(scope)?.delete(controller)
        if (!this.operations.get(scope)?.size) this.operations.delete(scope)
        await this.advance(scope)
      }
    }
  }

  dispose() {
    this.disposed = true
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer)
    for (const active of this.operations.values()) for (const controller of active) controller.abort()
  }
}
