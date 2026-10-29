// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import legacyState from '@shared/fixtures/store-v11.json'
import { IS_WEB_PREVIEW, prepareWorkspaceApi } from '@renderer/browser/webPreview'

describe('prepareWorkspaceApi', () => {
  afterEach(() => {
    delete (window as { workspaceApi?: unknown }).workspaceApi
    localStorage.clear()
  })

  it('leaves the bridge missing outside the web preview', async () => {
    expect(IS_WEB_PREVIEW).toBe(false)
    await prepareWorkspaceApi()
    expect(window.workspaceApi).toBeUndefined()
  })

  it('installs the demo API in the web preview', async () => {
    await prepareWorkspaceApi(true)
    expect(window.workspaceApi).toBeDefined()
  })

  it('loads existing preview storage and saves membership and terminal ownership in the same format', async () => {
    vi.resetModules()
    const stored = { collections: legacyState.collections, projects: legacyState.projects, terminals: legacyState.terminals }
    localStorage.setItem('workspace-manager:web-preview', JSON.stringify(stored))
    await prepareWorkspaceApi(true)
    // v11 previews could list several groups; the v12 view keeps the first, like the store migration.
    expect((await window.workspaceApi.workspaces.list())[0]?.groupId).toBe('active')
    expect((await window.workspaceApi.terminals.list())[0]?.workspaceId).toBe('p1')
    const [ungrouped] = await window.workspaceApi.groups.delete('active')
    expect(ungrouped?.groupId).toBeNull()
    const saved = JSON.parse(localStorage.getItem('workspace-manager:web-preview')!)
    expect(saved.projects[0].collectionIds).toEqual([])
    expect(saved.terminals[0].projectId).toBe('p1')
    expect(saved).not.toHaveProperty('workspaces')
    expect(saved.projects[0]).not.toHaveProperty('groupIds')
    expect(saved.terminals[0]).not.toHaveProperty('workspaceId')
  })

  it('previews nested Node installers and removes killed group history from saved storage', async () => {
    vi.resetModules()
    const stored = structuredClone(legacyState)
    stored.terminals.push({ ...stored.terminals[0]!, id: 'outside', projectId: 'outside' })
    stored.terminals[0]!.pinned = true
    stored.terminals[0]!.status = 'exited'
    localStorage.setItem('workspace-manager:web-preview', JSON.stringify({ collections: stored.collections, projects: stored.projects, terminals: stored.terminals }))
    await prepareWorkspaceApi(true)
    const commands = await window.workspaceApi.commands.list('p1')
    const install = commands.groups.flatMap((group) => group.commands).find((command) => command.id === 'p1::pkg-web::synthetic::node-install')
    expect(install).toMatchObject({ cwd: '/repos/demo/apps/web', script: 'pnpm install' })
    const removed = await window.workspaceApi.terminals.killGroup('active')
    expect(removed.map((session) => session.id)).toEqual([stored.terminals[0]!.id])
    expect((await window.workspaceApi.terminals.list()).map((session) => session.id)).toEqual(['outside'])
    expect(JSON.parse(localStorage.getItem('workspace-manager:web-preview')!).terminals.map((session: { id: string }) => session.id)).toEqual(['outside'])
  })
})
