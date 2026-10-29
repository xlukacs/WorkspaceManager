import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppCliHandler, type AppCliStore } from './appCliActions'
import { startAppCliServer } from './appCliServer'
import { TerminalManager } from './terminalManager'
import { resolveRunPlan } from './workspaceCommands'
import { runCli } from '@agent/cli'
import { callRunningApp } from '@agent/appClient'
import { handleMcpRequest } from '@agent/mcp'
import { defaultUiState } from '@shared/navigation'
import type { WorkspaceLease } from '@shared/appCli'
import type { GroupRecord, WorkspaceRecord } from '@shared/types'

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).reverse().forEach((fn) => fn()))
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wsm-live-actions-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const root = join(dir, 'repo'); mkdirSync(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { dev: 'node server.js' } }))
  let groups: GroupRecord[] = [], workspaces: WorkspaceRecord[] = [], ui = defaultUiState()
  const store: AppCliStore = {
    getGroups: () => groups, setGroups: (value) => { groups = value }, getWorkspaceRecords: () => workspaces,
    upsertWorkspaceRecord: (value) => { workspaces = [...workspaces.filter((entry) => entry.id !== value.id), value]; return value },
    getUiState: () => ui, setUiState: (value) => { ui = value }, getPreferredShell: () => 'bash'
  }
  const manager = new TerminalManager({ initialSessions: [], preferredShell: 'bash', onSessionChange: () => {},
    ptyFactory: () => ({ write() {}, kill() {}, onData() {}, onExit() {} }) })
  cleanup.push(() => manager.shutdown())
  const changed = vi.fn(), focus = vi.fn()
  const handle = createAppCliHandler({ store, terminals: manager, changed, focus,
    runStoredCommand: async (input) => {
      const workspace = workspaces.find((entry) => input.commandId.startsWith(`${entry.id}::`))!
      const plan = resolveRunPlan(workspace, input.commandId, input.worktreePath)!
      return manager.run({ workspaceId: workspace.id, commandId: plan.commandId, title: plan.title,
        worktreePath: input.worktreePath ?? workspace.rootPath, shellLine: plan.shellLine, runPlan: plan })
    } })
  const server = await startAppCliServer({ directory: dir, handle }); cleanup.push(() => server.close())
  const storePath = join(dir, 'workspace-manager.json')
  async function cli(args: string[]) {
    let output = '', error = ''
    const code = await runCli(['--store', storePath, ...args], { stdout: (text) => { output += text }, stderr: (text) => { error += text } })
    return { code, output, error }
  }
  return { dir, root, store, manager, handle, cli, changed, focus, storePath, server }
}
describe('CLI and MCP running-app actions', () => {
  it('registers, starts, lists, reads output, stops, and focuses the same GUI consoles', async () => {
    const ctx = await setup()
    expect((await ctx.cli(['add', ctx.root, '--group', 'Services', '--name', 'API'])).code).toBe(0)
    expect(ctx.store.getGroups()[0]?.name).toBe('Services')
    const started = await ctx.cli(['start', 'API', 'dev'])
    expect(started.code).toBe(0)
    const id = started.output.trim()
    expect(ctx.manager.list().find((session) => session.id === id)?.status).toBe('running')
    const sessions = JSON.parse((await ctx.cli(['sessions', '--group', 'Services', '--running', '--json'])).output)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).not.toHaveProperty('buffer')
    const mcp = async (name: string, args: Record<string, unknown>) => {
      const response = await handleMcpRequest({ id: 1, method: 'tools/call', params: { name, arguments: args } }, { storePath: ctx.storePath })
      return (response as { result: { isError: boolean; content: Array<{ text: string }> } }).result
    }
    const tools = await handleMcpRequest({ id: 2, method: 'tools/list' }, { storePath: ctx.storePath })
    expect((tools as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).toContain('start_command')
    const second = await mcp('start_command', { workspace: 'API', command: 'dev' })
    expect(second.isError).toBe(false)
    expect(ctx.manager.list()).toHaveLength(2)
    expect((await mcp('get_session_output', { sessionId: id })).content[0]?.text).toContain('npm run dev')
    expect((await mcp('stop_session', { sessionId: id })).isError).toBe(false)
    expect(ctx.manager.list().find((session) => session.id === id)?.status).toBe('stopped')
    await ctx.manager.togglePin(id)
    expect((await ctx.cli(['pause', '--group', 'Services'])).code).toBe(0)
    expect(ctx.manager.list().filter((session) => session.workspacePaused)).toHaveLength(1)
    expect((await ctx.cli(['resume', '--workspace', 'API'])).code).toBe(0)
    expect((await ctx.cli(['stop', '--group', 'Services'])).code).toBe(0)
    expect(ctx.manager.list()).toHaveLength(2)
    expect(ctx.manager.list().find((session) => session.id === id)?.pinned).toBe(true)
    expect(ctx.manager.list().every((session) => session.status === 'stopped' && !session.workspacePaused)).toBe(true)
    expect((await ctx.cli(['focus', '--session', id])).code).toBe(0)
    expect(ctx.focus).toHaveBeenCalled()
    expect(ctx.changed).toHaveBeenCalledWith(id)
    expect((await ctx.cli(['kill-all'])).code).toBe(0)
    expect(ctx.manager.list().every((session) => session.status === 'stopped')).toBe(true)
  })
  it('infers a registered workspace from cwd and registers unknown folders for arbitrary GUI commands', async () => {
    const ctx = await setup()
    await ctx.cli(['add', ctx.root])
    const sub = join(ctx.root, 'folder with spaces'); mkdirSync(sub)
    const result = await ctx.cli(['start', '--cwd', sub, '--label', 'Check', '--', 'node', '-e', 'console.log("hello world")'])
    expect(result.code).toBe(0)
    const session = ctx.manager.list().find((entry) => entry.id === result.output.trim())!
    expect(session.cwd).toBe(sub)
    expect(session.title).toBe('Check')
    expect(session.shellLine).toContain("'console.log(\"hello world\")'")
    expect(ctx.store.getWorkspaceRecords()).toHaveLength(1)
    const unknown = join(ctx.dir, 'unknown'); mkdirSync(unknown)
    await ctx.handle({ action: 'start', cwd: unknown, argv: ['echo registered'] })
    expect(ctx.store.getWorkspaceRecords()).toHaveLength(2)
    await expect(ctx.handle({ action: 'stop', workspace: 'demo', group: 'other' })).rejects.toThrow('either')
  })
  it('omits live MCP tools and reports the specified message after the app stops', async () => {
    const ctx = await setup(); ctx.server.close()
    expect((await ctx.cli(['sessions'])).error).toBe('Workspace Manager is not running\n')
    const tools = await handleMcpRequest({ id: 1, method: 'tools/list' }, { storePath: ctx.storePath })
    expect((tools as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).not.toContain('start_command')
  })
  it('protects the whole group across CLI and MCP and automatically starts the next queued project', async () => {
    const ctx = await setup()
    await ctx.cli(['add', ctx.root, '--group', 'Services', '--name', 'API'])
    const web = join(ctx.dir, 'web'); mkdirSync(web)
    writeFileSync(join(web, 'package.json'), JSON.stringify({ name: 'web', scripts: { dev: 'node server.js' } }))
    await ctx.cli(['add', web, '--group', 'Services', '--name', 'Web'])
    const owner = JSON.parse((await ctx.cli(['acquire', 'API', '--lease-ms', '600000', '--json'])).output) as WorkspaceLease
    const started = await ctx.cli(['start', 'API', 'dev', '--lease', owner.leaseId])
    const firstSession = started.output.trim()
    expect(started.code).toBe(0)
    for (const args of [
      ['start', 'Web', 'dev'], ['start', '--cwd', web, '--', 'echo nope'],
      ['stop', firstSession], ['pause', '--group', 'Services'], ['resume', '--workspace', 'API'],
      ['kill-all'], ['focus', 'API'], ['add', web, '--name', 'Renamed']
    ]) {
      const blocked = await ctx.cli(args)
      expect(blocked.code, args.join(' ')).toBe(1)
      expect(blocked.error).toContain('locked')
    }
    const mcp = await handleMcpRequest({ id: 1, method: 'tools/call', params: {
      name: 'stop_session', arguments: { sessionId: firstSession }
    } }, { storePath: ctx.storePath }) as { result: { isError: boolean } }
    expect(mcp.result.isError).toBe(true)
    expect(ctx.manager.list().find((session) => session.id === firstSession)?.status).toBe('running')

    let output = '', progress = ''
    const waiting = runCli(['--store', ctx.storePath, 'start', 'Web', 'dev', '--wait', '--lease-ms', '600000', '--json'], {
      stdout: (text) => { output += text }, stderr: (text) => { progress += text }
    })
    await vi.waitFor(() => expect(progress).toContain('Environment queued'))
    expect(ctx.manager.list().filter((session) => session.status === 'running')).toHaveLength(1)
    await ctx.cli(['release', owner.leaseId])
    expect(await waiting).toBe(0)
    const next = JSON.parse(output) as { sessionId: string; lease: WorkspaceLease }
    expect(next.lease.state).toBe('started')
    expect(progress).toContain('Environment started')
    expect(ctx.manager.list().find((session) => session.id === firstSession)?.status).toBe('stopped')
    expect(ctx.manager.list().find((session) => session.id === next.sessionId)?.status).toBe('running')
    expect((await ctx.cli(['stop', next.sessionId, '--lease', owner.leaseId])).code).toBe(1)
    expect((await ctx.cli(['stop', next.sessionId, '--lease', next.lease.leaseId])).code).toBe(0)
  })

  it('coordinates headless CLI and MCP runs and aborts an owner on release', async () => {
    const ctx = await setup()
    writeFileSync(join(ctx.root, 'package.json'), JSON.stringify({ name: 'demo', scripts: {
      build: `node -e "console.log('built')"`,
      hold: 'node hold.cjs'
    } }))
    writeFileSync(join(ctx.root, 'hold.cjs'), `require('fs').writeFileSync('ready', 'ready'); setInterval(() => {}, 1000)` )
    await ctx.cli(['add', ctx.root, '--group', 'Services'])
    writeFileSync(ctx.storePath, JSON.stringify({ version: 12, groups: ctx.store.getGroups(),
      workspaces: ctx.store.getWorkspaceRecords(), terminals: [], settings: { preferredShell: 'bash' } }))
    const owner = await ctx.handle({ action: 'acquire', workspace: 'demo', leaseMs: 600_000 }) as WorkspaceLease
    expect((await ctx.cli(['run', 'demo', 'build'])).error).toContain('locked')
    const mcp = await handleMcpRequest({ id: 1, method: 'tools/call', params: {
      name: 'run_command', arguments: { project: 'demo', command: 'build' }
    } }, { storePath: ctx.storePath }) as { result: { isError: boolean } }
    expect(mcp.result.isError).toBe(true)
    const result = await ctx.cli(['run', 'demo', 'build', '--lease', owner.leaseId, '--json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.output).steps[0].output).toContain('built')
    const next = await ctx.handle({ action: 'acquire', workspace: 'demo', leaseMs: 600_000 }) as WorkspaceLease
    const running = ctx.cli(['run', 'demo', 'hold', '--lease', owner.leaseId, '--timeout', '0', '--json'])
    await vi.waitFor(() => expect(existsSync(join(ctx.root, 'ready'))).toBe(true))
    await ctx.handle({ action: 'release', leaseId: owner.leaseId })
    expect((await running).code).not.toBe(0)
    expect(await ctx.handle({ action: 'lease-status', leaseId: next.leaseId })).toMatchObject({ state: 'started' })
    await ctx.handle({ action: 'release', leaseId: next.leaseId })
    const automatic = await ctx.cli(['run', 'demo', 'build', '--wait', '--lease-ms', '600000', '--json'])
    expect(automatic.code).toBe(0)
    expect(JSON.parse(automatic.output).exitCode).toBe(0)
    const free = await ctx.handle({ action: 'acquire', workspace: 'demo', leaseMs: 600_000 }) as WorkspaceLease
    expect(free.state).toBe('started')
  })

  it('cancels an interrupted CLI waiter without admitting it', async () => {
    const ctx = await setup()
    await ctx.cli(['add', ctx.root])
    const owner = await ctx.handle({ action: 'acquire', workspace: 'demo', leaseMs: 600_000 }) as WorkspaceLease
    let progress = ''
    const waiter = runCli(['--store', ctx.storePath, 'acquire', 'demo', '--wait', '--lease-ms', '600000'], {
      stdout: () => {}, stderr: (text) => { progress += text }
    })
    await vi.waitFor(() => expect(progress).toContain('Environment queued'))
    process.emit('SIGINT')
    expect(await waiter).toBe(1)
    expect(progress).toContain('cancelled')
    await ctx.handle({ action: 'release', leaseId: owner.leaseId })
    expect(await ctx.handle({ action: 'acquire', workspace: 'demo', leaseMs: 600_000 })).toMatchObject({ state: 'started' })
  })

  it('aborts disconnected headless clients and admits the queued owner', async () => {
    const ctx = await setup()
    writeFileSync(join(ctx.root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { hold: 'node hold.cjs' } }))
    writeFileSync(join(ctx.root, 'hold.cjs'), `require('fs').writeFileSync('ready', 'ready'); setInterval(() => {}, 1000)`)
    await ctx.cli(['add', ctx.root])
    const running = callRunningApp({ action: 'run', workspace: 'demo', command: 'hold', timeoutMs: 0 }, {
      storePath: ctx.storePath, timeoutMs: 1000
    }).catch((error: Error) => error.message)
    await vi.waitFor(() => expect(existsSync(join(ctx.root, 'ready'))).toBe(true))
    const next = await ctx.handle({ action: 'acquire', workspace: 'demo', leaseMs: 600_000 }) as WorkspaceLease
    expect(next.state).toBe('queued')
    expect(await running).toContain('timed out')
    await vi.waitFor(async () => {
      expect(await ctx.handle({ action: 'lease-status', leaseId: next.leaseId })).toMatchObject({ state: 'started' })
    })
  })

  it('requires an explicit duration and rejects leases longer than ten minutes through CLI and MCP', async () => {
    const ctx = await setup()
    await ctx.cli(['add', ctx.root])
    for (const flags of [[], ['--lease-ms', '600001'], ['--lease-ms', '0']]) {
      const result = await ctx.cli(['acquire', 'demo', ...flags])
      expect(result.code).toBe(1)
      expect(result.error).toContain('--lease-ms')
    }
    const missingStartDuration = await ctx.cli(['start', 'demo', 'dev', '--wait'])
    expect(missingStartDuration.code).toBe(1)
    expect(ctx.manager.list()).toHaveLength(0)
    for (const args of [{ workspace: 'demo' }, { workspace: 'demo', leaseMs: 600001 }]) {
      const response = await handleMcpRequest({ id: 1, method: 'tools/call', params: {
        name: 'acquire_environment', arguments: args
      } }, { storePath: ctx.storePath }) as { result: { isError: boolean; content: Array<{ text: string }> } }
      expect(response.result.isError).toBe(true)
      expect(response.result.content[0].text).toContain('leaseMs')
    }
    const valid = await ctx.cli(['acquire', 'demo', '--lease-ms', '600000', '--json'])
    expect(valid.code).toBe(0)
    const lease = JSON.parse(valid.output) as WorkspaceLease
    expect(lease.state).toBe('started')
    expect(lease.expiresAt! - lease.startedAt!).toBe(600000)
  })

})
