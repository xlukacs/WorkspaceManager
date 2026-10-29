import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceLeases } from './workspaceLeases'
import { MAX_LEASE_MS } from '@shared/appCli'

const managers: WorkspaceLeases[] = []
afterEach(() => { managers.splice(0).forEach((manager) => manager.dispose()); vi.useRealTimers() })
function setup(stop = vi.fn(async (_ids: string[]) => {})) {
  const leases = new WorkspaceLeases(stop)
  managers.push(leases)
  return { leases, stop }
}

describe('exclusive workspace leases', () => {
  it('admits FIFO waiters independently in each scope and cancels queued entries', async () => {
    const { leases } = setup()
    const first = await leases.acquire('group:one', ['a', 'b'], MAX_LEASE_MS)
    const second = await leases.acquire('group:one', ['a', 'b'], MAX_LEASE_MS)
    const third = await leases.acquire('group:one', ['a', 'b'], MAX_LEASE_MS)
    const other = await leases.acquire('group:two', ['c'], MAX_LEASE_MS)
    expect(first.state).toBe('started')
    expect(other.state).toBe('started')
    expect(second).toMatchObject({ state: 'queued', position: 1, expiresAt: null })
    expect(third.position).toBe(2)
    await leases.release(second.leaseId)
    expect(await leases.status(third.leaseId)).toMatchObject({ state: 'queued', position: 1 })
    await leases.release(first.leaseId)
    expect((await leases.status(third.leaseId)).state).toBe('started')
    expect((await leases.status(second.leaseId)).state).toBe('released')
  })

  it('expires abandoned owners, renews deadlines, and starts TTL on admission', async () => {
    vi.useFakeTimers()
    const { leases } = setup()
    const first = await leases.acquire('scope', ['a'], 100)
    const second = await leases.acquire('scope', ['a'], 200)
    await vi.advanceTimersByTimeAsync(75)
    await leases.renew(first.leaseId, 100)
    await vi.advanceTimersByTimeAsync(50)
    expect((await leases.status(second.leaseId)).state).toBe('queued')
    await vi.advanceTimersByTimeAsync(50)
    expect((await leases.status(first.leaseId)).state).toBe('expired')
    const admitted = await leases.status(second.leaseId)
    expect(admitted.state).toBe('started')
    expect(admitted.expiresAt! - admitted.startedAt!).toBe(200)
    await expect(leases.renew(first.leaseId)).rejects.toThrow('expired')
  })

  it('validates ownership for every target before making changes', async () => {
    const { leases } = setup()
    const first = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    const queued = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    const action = vi.fn(async () => 'ok')
    await expect(leases.control(['one'], undefined, action)).rejects.toThrow('locked')
    await expect(leases.control(['one'], queued.leaseId, action)).rejects.toThrow('inactive')
    await expect(leases.control(['two'], first.leaseId, action)).rejects.toThrow('every target')
    await expect(leases.control(['two', 'one'], undefined, action)).rejects.toThrow('locked')
    expect(action).not.toHaveBeenCalled()
    expect(await leases.control(['one'], first.leaseId, action)).toBe('ok')
    await leases.release(first.leaseId)
    await expect(leases.control(['one'], first.leaseId, action)).rejects.toThrow('inactive')
  })

  it('aborts an in-flight command but waits for it and console cleanup before handoff', async () => {
    const { leases, stop } = setup()
    const first = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    const next = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    let finish!: () => void
    let signal!: AbortSignal
    const action = leases.control(['one'], first.leaseId, async (input) => {
      signal = input
      await new Promise<void>((resolve) => { finish = resolve })
    })
    await vi.waitFor(() => expect(finish).toBeDefined())
    await leases.release(first.leaseId)
    expect(signal.aborted).toBe(true)
    expect((await leases.status(next.leaseId)).state).toBe('queued')
    expect(stop).toHaveBeenCalledTimes(1)
    finish()
    await action
    expect((await leases.status(next.leaseId)).state).toBe('started')
    expect(stop).toHaveBeenCalledWith(['a'], 'one')
  })

  it('does not admit a successor when stopping the previous environment fails', async () => {
    const { leases, stop } = setup()
    const first = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    const second = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    stop.mockRejectedValueOnce(new Error('Unable to stop environment'))
    await expect(leases.release(first.leaseId)).rejects.toThrow('Unable to stop')
    const action = vi.fn(async () => {})
    stop.mockRejectedValueOnce(new Error('Unable to stop environment'))
    await expect(leases.control(['one'], second.leaseId, action)).rejects.toThrow('Unable to stop')
    expect(action).not.toHaveBeenCalled()
    expect((await leases.status(second.leaseId)).state).toBe('started')
  })

  it('shares initial cleanup between concurrent acquisitions', async () => {
    let finish!: () => void
    const stop = vi.fn(async (_ids: string[]) => {})
    stop.mockImplementationOnce(async () => new Promise<void>((resolve) => { finish = resolve }))
    const { leases } = setup(stop)
    const acquiring = leases.acquire('one', ['a'], MAX_LEASE_MS)
    await vi.waitFor(() => expect(finish).toBeDefined())
    // A second acquisition must share the cleanup rather than admitting twice.
    const next = leases.acquire('one', ['a'], MAX_LEASE_MS)
    finish()
    const [first, second] = await Promise.all([acquiring, next])
    expect(first.state).toBe('started')
    expect(second.state).toBe('queued')
  })

  it('pins unreserved controls and queues new owners until they finish', async () => {
    const { leases } = setup()
    let finish!: () => void
    const action = leases.control(['one'], undefined, async () => new Promise<void>((resolve) => { finish = resolve }))
    await vi.waitFor(() => expect(finish).toBeDefined())
    const lease = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    expect(lease.state).toBe('queued')
    finish()
    await action
    expect((await leases.status(lease.leaseId)).state).toBe('started')
  })


  it('aborts expired operations and holds admission until they finish', async () => {
    vi.useFakeTimers()
    const { leases } = setup()
    const owner = await leases.acquire('one', ['a'], 100)
    const next = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    let finish!: () => void
    let signal!: AbortSignal
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const running = leases.control(['one'], owner.leaseId, async (input) => {
      signal = input
      entered()
      await new Promise<void>((resolve) => { finish = resolve })
    })
    await ready
    await vi.advanceTimersByTimeAsync(100)
    expect(signal.aborted).toBe(true)
    expect((await leases.status(next.leaseId)).state).toBe('queued')
    finish()
    await running
    expect((await leases.status(next.leaseId)).state).toBe('started')
  })

  it('cancels a waiter during predecessor cleanup without stranding its successor', async () => {
    const { leases, stop } = setup()
    const owner = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    const cancel = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    const next = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    let finish!: () => void
    stop.mockImplementationOnce(async () => new Promise<void>((resolve) => { finish = resolve }))
    const releasing = leases.release(owner.leaseId)
    await vi.waitFor(() => expect(finish).toBeDefined())
    const cancelling = leases.release(cancel.leaseId)
    finish()
    await Promise.all([releasing, cancelling])
    expect((await leases.status(cancel.leaseId)).state).toBe('released')
    expect((await leases.status(next.leaseId)).state).toBe('started')
  })

  it('enforces a hard ten-minute limit even when the owner renews', async () => {
    vi.useFakeTimers()
    const { leases, stop } = setup()
    const owner = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    const next = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    await vi.advanceTimersByTimeAsync(MAX_LEASE_MS - 1)
    const renewed = await leases.renew(owner.leaseId, MAX_LEASE_MS)
    expect(renewed.expiresAt).toBe(owner.startedAt! + MAX_LEASE_MS)
    await vi.advanceTimersByTimeAsync(1)
    expect((await leases.status(owner.leaseId)).state).toBe('expired')
    expect((await leases.status(next.leaseId)).state).toBe('started')
    expect(stop).toHaveBeenCalledWith(['a'], 'one')
    await expect(leases.control(['one'], owner.leaseId, async () => {})).rejects.toThrow('inactive')
  })

  it('requires a valid explicit renewal duration without changing the existing deadline', async () => {
    const { leases } = setup()
    const owner = await leases.acquire('one', ['a'], MAX_LEASE_MS)
    for (const value of [undefined, 0, MAX_LEASE_MS + 1]) {
      await expect(leases.renew(owner.leaseId, value)).rejects.toThrow('leaseMs')
      expect((await leases.status(owner.leaseId)).expiresAt).toBe(owner.expiresAt)
    }
  })

  it('rejects invalid durations and unknown tokens', async () => {
    const { leases } = setup()
    for (const value of [undefined, 0, -1, 1.5, NaN, Infinity, MAX_LEASE_MS + 1]) {
      await expect(leases.acquire('one', ['a'], value)).rejects.toThrow('leaseMs')
    }
    await expect(leases.status('missing')).rejects.toThrow('Unknown lease')
    await expect(leases.release('missing')).rejects.toThrow('Unknown lease')
  })
})
