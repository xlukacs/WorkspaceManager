import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '@shared/fixtures/store-v11.json'
import { decodeWorkspaceState } from '@shared/workspaceModel'
import type { PersistedState } from '@shared/persistedState'
import type { WorkspaceRecord } from '@shared/types'
import { refreshWorkspace, rescanWorkspaceQueue, scanWorkspace } from './workspaceScan'

const roots: string[] = []
async function workspace(id = 'p1') {
  const path = await mkdtemp(join(tmpdir(), 'wsm-rescan-'))
  roots.push(path)
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'rescanned', scripts: { dev: 'vite' } }))
  return { ...decodeWorkspaceState(fixture as PersistedState).workspaces[0]!, id, rootPath: path }
}
function memoryStore(workspaces: WorkspaceRecord[]) {
  const records = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  return {
    records,
    getWorkspaceRecords: () => [...records.values()],
    getWorkspaceRecord: vi.fn((id: string) => records.get(id) ?? null),
    upsertWorkspaceRecord: vi.fn((workspace: WorkspaceRecord) => { records.set(workspace.id, workspace); return workspace })
  }
}
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('workspace rescan queue', () => {
  it('defers work and continues to the next workspace after a failure', async () => {
    const valid = await workspace()
    const missing = { ...valid, id: 'missing', rootPath: join(valid.rootPath, 'deleted') }
    const store = memoryStore([missing, valid])
    const updated = vi.fn()
    const error = vi.fn()
    const completion = rescanWorkspaceQueue(store, updated, error)
    expect(store.getWorkspaceRecord).not.toHaveBeenCalled()
    await completion
    expect(error).toHaveBeenCalledExactlyOnceWith('missing', expect.any(Error))
    expect(updated).toHaveBeenCalledOnce()
    expect(store.records.get(valid.id)?.projects[0]?.scripts).toEqual({ dev: 'vite' })
  })

  it('preserves edits that arrive during a scan and does not restore a deleted workspace', async () => {
    const entry = await workspace()
    const store = memoryStore([entry])
    const pending = refreshWorkspace(store, entry.id)
    store.records.set(entry.id, { ...entry, name: 'Custom', nameOverride: 'Custom', groupId: null, favoriteCommandIds: ['new-favorite'], openTarget: 'cursor' })
    await pending
    expect(store.records.get(entry.id)).toMatchObject({ name: 'Custom', groupId: null, favoriteCommandIds: ['new-favorite'], openTarget: 'cursor' })
    expect(store.records.get(entry.id)?.projects[0]?.scripts).toEqual({ dev: 'vite' })

    const deleted = refreshWorkspace(store, entry.id)
    store.records.delete(entry.id)
    expect(await deleted).toBeNull()
    expect(store.records.has(entry.id)).toBe(false)
  })

  it('keeps custom worktree roots and excludes their contents during a scan', async () => {
    const entry = await workspace()
    const checkout = join(entry.rootPath, 'custom-checkouts')
    await mkdir(join(checkout, 'feature'), { recursive: true })
    await writeFile(join(checkout, 'feature', 'package.json'), '{"name":"must-not-scan"}')
    const scanned = await scanWorkspace(entry.rootPath, 'active', { ...entry, gitWorktreesRoot: checkout })
    expect(scanned.gitWorktreesRoot).toBe(checkout)
    expect(scanned.projects.map((project) => project.relativePath)).toEqual([''])
  })
})
