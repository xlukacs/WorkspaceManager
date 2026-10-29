import { setTimeout as delay } from 'node:timers/promises'
import { MAX_LEASE_MS, type WorkspaceLease } from '@shared/appCli'
import { callRunningApp } from './appClient'
import { flagBoolean, flagString, type ParsedCli } from './parseCli'
import type { CliIo } from './cli'

/** Poll short requests so a waiting agent never occupies the app's command queue. */
export async function acquireLeaseFromCli(parsed: ParsedCli, io: CliIo): Promise<WorkspaceLease> {
  const options = { storePath: flagString(parsed.flags, 'store') }
  const duration = Number(flagString(parsed.flags, 'lease-ms'))
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_LEASE_MS) {
    throw new Error(`--lease-ms is required: an integer between 1 and ${MAX_LEASE_MS} (maximum 10 minutes).`)
  }
  const abort = new AbortController()
  const interrupt = () => abort.abort()
  const wait = flagBoolean(parsed.flags, 'wait')
  if (wait) {
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
  }
  let lease: WorkspaceLease | undefined
  try {
    lease = await callRunningApp({ action: 'acquire',
      workspace: flagString(parsed.flags, 'workspace') ?? parsed.positionals[0], group: flagString(parsed.flags, 'group'),
      label: flagString(parsed.flags, 'label'), leaseMs: duration
    }, options) as WorkspaceLease
    let lastPosition: number | undefined
    while (lease.state === 'queued') {
      if (lastPosition !== lease.position) io.stderr(`Environment queued (position ${lease.position}). Lease ${lease.leaseId}\n`)
      lastPosition = lease.position
      if (!wait) return lease
      await delay(500, undefined, { signal: abort.signal })
      lease = await callRunningApp({ action: 'lease-status', leaseId: lease.leaseId }, options) as WorkspaceLease
    }
    if (abort.signal.aborted) throw new Error('Lease wait cancelled.')
    if (lease.state !== 'started') throw new Error(`Lease ${lease.state} before the environment started.`)
    io.stderr(`Environment started. Lease ${lease.leaseId}; expires ${new Date(lease.expiresAt!).toISOString()}\n`)
    return lease
  } catch (error) {
    if (lease) {
      try { await callRunningApp({ action: 'release', leaseId: lease.leaseId }, options) }
      catch { /* App may have exited; its in-memory leases end with it. */ }
    }
    if (abort.signal.aborted) throw new Error('Lease wait cancelled.')
    throw error
  } finally {
    if (wait) {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
    }
  }
}
