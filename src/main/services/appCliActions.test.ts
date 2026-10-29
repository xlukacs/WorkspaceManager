import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppCliHandler, type AppCliStore } from './appCliActions'
import { startAppCliServer } from './appCliServer'
import { TerminalManager } from './terminalManager'
import { resolveRunPlan } from './workspaceCommands'
import { runCli } from '@agent/cli'
import { handleMcpRequest } from '@agent/mcp'
import { defaultUiState } from '@shared/navigation'
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
      const workspace = workspaces[0]!
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
})
