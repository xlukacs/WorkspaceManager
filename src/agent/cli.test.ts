import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCliArgs, rewriteLeaseAlias } from '@agent/parseCli'
import { catalogFromState } from '@agent/catalog'
import { handleMcpRequest, PROTOCOL_VERSION } from '@agent/mcp'
import { runCli } from '@agent/cli'
import { workspaceToDisk } from '@shared/persistedState'
import legacyState from '@shared/fixtures/store-v11.json'
import type { LegacyWorkspaceRecord, LegacyState } from '@shared/types'

const workspace: LegacyWorkspaceRecord = {
  id: 'p1',
  name: 'demo',
  nameOverride: null,
  order: 0,
  rootPath: '/repos/demo',
  groupIds: ['active'],
  packageManager: 'pnpm',
  isMonorepo: false,
  rootScripts: { build: 'tsc' },
  workspacePackages: [],
  docker: null,
  pythonEnvironment: null,
  commandChains: {},
  favoriteCommandIds: [],
  runActions: [],
  defaultRunActionId: null,
  lastScanAt: 1,
  quickLinks: [],
  gitSummary: { branch: 'main', isDirty: true, stagedCount: 1, unstagedCount: 0, untrackedCount: 0, lastCommitSubject: 'wip', lastCommitRelative: '1m ago', lastCommitTimestamp: 1 },
  gitWorktrees: [],
  gitWorktreesRoot: null
}

const catalog = catalogFromState({
  version: 11,
  groups: [{ id: 'active', name: 'Active', order: 0 }],
  workspaces: [workspace],
  terminals: [],
  settings: { preferredShell: 'bash' }
} satisfies LegacyState, '/tmp/store.json')

describe('CLI parsing', () => {
  it('parses run workspace + command and flags', () => {
    const parsed = parseCliArgs(['run', 'demo', 'Compose', 'Up', '--json', '--timeout', '5000', '--dry-run'])
    expect(parsed.command).toBe('run')
    expect(parsed.positionals).toEqual(['demo', 'Compose', 'Up'])
    expect(parsed.flags.json).toBe(true)
    expect(parsed.flags['dry-run']).toBe(true)
    expect(parsed.flags.timeout).toBe('5000')
  })

  it('strips node argv prefixes', () => {
    expect(parseCliArgs(['/usr/bin/node', '/app/out/cli/index.js', 'list']).command).toBe('list')
  })

  it('parses HTTP MCP bind flags', () => {
    const parsed = parseCliArgs(['mcp', '--http', '--host', '0.0.0.0', '--port', '3847', '--token', 's3cret'])
    expect(parsed.command).toBe('mcp')
    expect(parsed.flags.http).toBe(true)
    expect(parsed.flags.host).toBe('0.0.0.0')
    expect(parsed.flags.port).toBe('3847')
    expect(parsed.flags.token).toBe('s3cret')
  })

  it('maps lease and queue help aliases onto the documented lease commands', () => {
    expect(rewriteLeaseAlias(parseCliArgs(['lease', 'help'])).command).toBe('help')
    expect(rewriteLeaseAlias(parseCliArgs(['queue'])).command).toBe('help')
    expect(rewriteLeaseAlias(parseCliArgs(['lease', 'acquire', 'api', '--lease-ms', '1000']))).toMatchObject({
      command: 'acquire',
      positionals: ['api'],
      flags: { 'lease-ms': '1000' }
    })
    expect(rewriteLeaseAlias(parseCliArgs(['lease', 'status', 'lease-1'])).command).toBe('lease-status')
  })
})

describe('MCP protocol', () => {
  it('initializes and lists tools', async () => {
    const initialized = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    }, { catalogLoader: () => catalog })
    expect(initialized).toMatchObject({
      result: { protocolVersion: '2024-11-05', serverInfo: { name: 'workspace-manager' } }
    })

    const listed = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { catalogLoader: () => catalog, storePath: '/nonexistent/wsm-test-store.json' })
    expect((listed as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).toEqual([
      'list_workspaces',
      'get_workspace',
      'list_commands',
      'run_command'
    ])
  })

  it('lists workspaces and dry-runs a command', async () => {
    const workspaces = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_workspaces', arguments: {} }
    }, { catalogLoader: () => catalog })
    const workspaceText = (workspaces as { result: { content: Array<{ text: string }> } }).result.content[0]?.text ?? ''
    expect(workspaceText).toContain('"name": "demo"')

    const ran = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'run_command', arguments: { project: 'demo', command: 'build', dryRun: true } }
    }, { catalogLoader: () => catalog })
    const runText = (ran as { result: { content: Array<{ text: string }> } }).result.content[0]?.text ?? ''
    expect(runText).toContain('pnpm run build')
    expect(runText).toContain('"exitCode": 0')
  })
})

describe('MCP protocol edge cases', () => {
  it('negotiates a supported protocol version instead of echoing unknown ones', async () => {
    const init = (protocolVersion: string) => handleMcpRequest({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion }
    }, { catalogLoader: () => catalog }) as Promise<{ result: { protocolVersion: string } }>
    expect((await init('2025-03-26')).result.protocolVersion).toBe('2025-03-26')
    expect((await init('2099-01-01')).result.protocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('ignores client responses instead of answering them with an error', async () => {
    expect(await handleMcpRequest({ jsonrpc: '2.0', id: 7, result: {} } as never)).toBeNull()
  })

  it('rejects a negative run timeout', async () => {
    const ran = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'run_command', arguments: { project: 'demo', command: 'build', timeoutMs: -1 } }
    }, { catalogLoader: () => catalog }) as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(ran.result.isError).toBe(true)
    expect(ran.result.content[0]?.text).toContain('timeoutMs')
  })
})

describe('CLI help', () => {
  it('prints help without loading the store', async () => {
    let out = ''
    const code = await runCli(['help'], {
      stdout: (text) => {
        out += text
      },
      stderr: () => undefined
    })
    expect(code).toBe(0)
    expect(out).toContain('workspace-manager mcp --http')
  })

  it('documents environment leases and the FIFO queue', async () => {
    const help = async (args: string[]) => {
      let output = ''
      const code = await runCli(args, { stdout: (text) => { output += text }, stderr: () => undefined })
      return { code, output }
    }
    for (const args of [['help'], ['lease'], ['lease', 'help'], ['queue']]) {
      const result = await help(args)
      expect(result.code, args.join(' ')).toBe(0)
      expect(result.output).toContain('Environment leases')
      expect(result.output).toContain('FIFO queue')
      expect(result.output).toContain('workspace-manager acquire')
      expect(result.output).toContain('lease-status')
      expect(result.output).toContain('--wait')
    }
  })

  it('treats a bare workspace name as incomplete run usage', async () => {
    let err = ''
    const code = await runCli(['run', 'demo'], {
      stdout: () => undefined,
      stderr: (text) => {
        err += text
      }
    })
    expect(code).toBe(1)
    expect(err).toContain('Usage: workspace-manager run demo <command>')
  })
})

describe('CLI run --worktree', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('dry-runs python:install entirely inside the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wsm-cli-python-'))
    roots.push(root)
    const repo = join(root, 'repo')
    const worktree = join(root, 'repo-feature')
    await mkdir(repo)
    await mkdir(worktree)
    await writeFile(join(repo, 'requirements.txt'), 'requests\n')
    const storePath = join(root, 'workspace-manager.json')
    const pythonWorkspace: LegacyWorkspaceRecord = {
      ...workspace,
      id: 'py',
      name: 'pyapp',
      rootPath: repo,
      packageManager: 'unknown',
      rootScripts: {},
      gitSummary: null,
      gitWorktrees: [
        { path: repo, branch: 'main', head: null, isMain: true, isBare: false, isLocked: false },
        { path: worktree, branch: 'feature', head: null, isMain: false, isBare: false, isLocked: false }
      ]
    }
    await writeFile(storePath, JSON.stringify({
      version: 11,
      collections: [],
      projects: [workspaceToDisk(pythonWorkspace)],
      terminals: [],
      settings: { preferredShell: 'bash' }
    }))

    let out = ''
    const code = await runCli(
      ['run', 'pyapp', 'python:install', '--worktree', 'feature', '--dry-run', '--json', '--store', storePath],
      { stdout: (text) => { out += text }, stderr: () => undefined }
    )
    expect(code).toBe(0)
    const result = JSON.parse(out) as { steps: Array<{ title: string; cwd: string; shellLine: string }> }
    expect(result.steps.map((step) => step.title)).toEqual(['Create .venv', 'python:install'])
    for (const step of result.steps) expect(step.cwd).toBe(worktree)
    expect(result.steps[1]?.shellLine).toContain('-m pip install -r requirements.txt')
  })
})

describe('CLI and MCP v11 compatibility', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('reads v11 with single-group membership while preserving public fields, flags and command IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wsm-cli-v11-'))
    roots.push(root)
    const storePath = join(root, 'workspace-manager.json')
    await writeFile(storePath, JSON.stringify(legacyState))
    const cli = async (args: string[]) => {
      let out = ''
      let err = ''
      const code = await runCli([...args, '--store', storePath, '--json'], {
        stdout: (text) => { out += text }, stderr: (text) => { err += text }
      })
      expect(err).toBe('')
      expect(code).toBe(0)
      return JSON.parse(out)
    }
    const listed = await cli(['list', '--collection', 'Active'])
    expect(listed).toEqual([{
      id: 'p1', name: 'demo', rootPath: '/repos/demo', collections: ['Active'],
      packageManager: 'pnpm', isMonorepo: true, branch: null, isDirty: false,
      worktreeCount: 1, favoriteCommandCount: 2, runActionCount: 1, hasDocker: true
    }])
    const commands = await cli(['commands', '--project', 'demo']) as Array<Record<string, unknown>>
    expect(commands).toContainEqual({
      id: 'p1::pkg-web::dev', projectId: 'p1', kind: 'script', name: 'dev',
      title: '@demo/web · dev', cwd: '/repos/demo/apps/web', favorite: true,
      description: 'vite', shellPreview: 'vite'
    })
    expect(commands.every((command) => !('workspaceId' in command))).toBe(true)
    const run = await cli(['run', '--project', 'demo', '--command', 'build', '--dry-run'])
    expect(run.project).toEqual({ id: 'p1', name: 'demo', rootPath: '/repos/demo' })
    expect(run).not.toHaveProperty('workspace')
    expect(run.command.id).toBe('p1::root::build')
    expect(run.steps.map((step: { title: string }) => step.title)).toEqual(['@demo/web · test', 'build'])

    const mcp = async (name: string, args: object) => {
      const response = await handleMcpRequest({
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args }
      }, { storePath }) as { result: { content: Array<{ text: string }>; isError?: boolean } }
      expect(response.result.isError).not.toBe(true)
      return JSON.parse(response.result.content[0]!.text)
    }
    expect(await mcp('list_workspaces', { collection: 'Active' })).toEqual(listed)
    expect(await mcp('list_commands', { project: 'demo' })).toEqual(commands)
    const mcpRun = await mcp('run_command', { project: 'demo', command: 'build', dryRun: true })
    expect(mcpRun.project).toEqual(run.project)
    expect(mcpRun.steps).toEqual(run.steps)
    expect(mcpRun).not.toHaveProperty('workspace')
  })
})
