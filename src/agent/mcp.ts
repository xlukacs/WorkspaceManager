import { callRunningApp, runningAppAvailable } from './appClient'
import type { AppCliRequest } from '@shared/appCli'
import { createInterface } from 'node:readline'
import {
  findWorkspace,
  getWorkspaceDetails,
  listWorkspaceCommandsIn,
  listWorkspaces,
  loadCatalog,
  resolveRunnable
} from '@agent/catalog'
import { DEFAULT_RUN_TIMEOUT_MS, executeRunPlan } from '@agent/runCommand'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]
export const DEFAULT_MCP_PORT = 3847

export interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

export interface McpOptions {
  storePath?: string | null
  catalogLoader?: typeof loadCatalog
}

export function serverVersion() {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'package.json'),
    join(here, '../../package.json'),
    join(here, '../../../package.json')
  ]
  for (const packageJsonPath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }
      if (pkg.version) return pkg.version
    } catch {
      // Try the next location (repo, deb, Docker).
    }
  }
  return '0.1.0'
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    isError
  }
}

function errorResult(error: unknown) {
  return textResult(error instanceof Error ? error.message : String(error), true)
}

export const MCP_TOOLS = [
  {
    name: 'list_workspaces',
    description: 'List registered workspaces (id, name, path, branch, group memberships, package manager).',
    inputSchema: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'Optional group name or id to filter by (legacy field name).'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_workspace',
    description: 'Get one workspace by id, name, or root path, including worktrees, scripts, docker, and run actions.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Workspace id, name, or root path.'
        }
      },
      required: ['project'],
      additionalProperties: false
    }
  },
  {
    name: 'list_commands',
    description: 'List runnable script, docker, and Run-action commands for a workspace. Use the returned id with run_command.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Workspace id, name, or root path.'
        },
        worktree: {
          type: 'string',
          description: 'Optional git worktree whose checkout each cwd should point at: its path or branch name.'
        }
      },
      required: ['project'],
      additionalProperties: false
    }
  },
  {
    name: 'run_command',
    description:
      'Run a Workspace Manager command (npm/pnpm/yarn script, docker helper, or Run action) in that workspace. Long-running commands (dev/watch) are killed at timeoutMs (default 120000; 0 waits forever).',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Full command id, script name, docker title, or Run action description.'
        },
        project: {
          type: 'string',
          description: 'Workspace id, name, or path. Required unless command is a full id.'
        },
        worktree: {
          type: 'string',
          description: 'Optional git worktree to run in: its checkout path or branch name (see get_workspace).'
        },
        timeoutMs: {
          type: 'number',
          description: `Kill after this many milliseconds. Default ${DEFAULT_RUN_TIMEOUT_MS}. 0 means no timeout.`
        },
        dryRun: {
          type: 'boolean',
          description: 'Resolve the plan without executing.'
        }
      },
      required: ['command'],
      additionalProperties: false
    }
  }
] as const

export const LIVE_MCP_TOOLS = [
  { name: 'list_sessions', description: 'List consoles in the running app.', inputSchema: { type: 'object', properties: { workspace: { type: 'string' }, group: { type: 'string' }, running: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'start_command', description: 'Start a stored command in a GUI console and return its session id.', inputSchema: { type: 'object', properties: { workspace: { type: 'string' }, command: { type: 'string' }, worktree: { type: 'string' } }, required: ['workspace', 'command'], additionalProperties: false } },
  { name: 'stop_session', description: 'Stop one GUI console.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false } },
  { name: 'get_session_output', description: 'Read the last N KiB of a GUI console buffer (default 16, maximum 256).', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, limitKb: { type: 'number', minimum: 1, maximum: 256 } }, required: ['sessionId'], additionalProperties: false } }
] as const

function readArgs(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {}
  const record = params as { arguments?: Record<string, unknown>; name?: string }
  if (record.arguments && typeof record.arguments === 'object') return record.arguments
  return params as Record<string, unknown>
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanArg(args: Record<string, unknown>, key: string) {
  return args[key] === true
}

export async function handleMcpRequest(request: JsonRpcRequest, options: McpOptions = {}) {
  const method = request.method ?? ''
  const id = request.id
  const load = options.catalogLoader ?? loadCatalog
  const catalogOptions = { storePath: options.storePath }

  // Notifications, and responses to requests we never send, need no reply.
  if (!method || method.startsWith('notifications/')) {
    return null
  }

  if (method === 'initialize') {
    const clientVersion = (request.params as { protocolVersion?: string } | undefined)?.protocolVersion
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === clientVersion) ?? PROTOCOL_VERSION
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'workspace-manager', version: serverVersion() }
      }
    }
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [...MCP_TOOLS, ...(await runningAppAvailable(catalogOptions) ? LIVE_MCP_TOOLS : [])] } }
  }

  if (method === 'tools/call') {
    const params = (request.params ?? {}) as { name?: string }
    const args = readArgs(request.params)
    try {
      const liveAction = ({ list_sessions: 'sessions', start_command: 'start', stop_session: 'stop', get_session_output: 'output' } as Record<string, AppCliRequest['action']>)[params.name ?? '']
      if (liveAction) {
        if (liveAction === 'start' && (!stringArg(args, 'workspace') || !stringArg(args, 'command'))) throw new Error('workspace and command are required')
        if ((liveAction === 'stop' || liveAction === 'output') && !stringArg(args, 'sessionId')) throw new Error('sessionId is required')
        const result = await callRunningApp({ action: liveAction, workspace: stringArg(args, 'workspace'), group: stringArg(args, 'group'),
          command: stringArg(args, 'command'), worktree: stringArg(args, 'worktree'), sessionId: stringArg(args, 'sessionId'),
          running: booleanArg(args, 'running'), limitKb: numberArg(args, 'limitKb') }, catalogOptions)
        return { jsonrpc: '2.0', id, result: textResult(result) }
      }
      const catalog = load(catalogOptions)
      if (params.name === 'list_workspaces') {
        return {
          jsonrpc: '2.0',
          id,
          result: textResult(listWorkspaces(catalog, stringArg(args, 'collection')))
        }
      }
      if (params.name === 'get_workspace') {
        const project = stringArg(args, 'project')
        if (!project) return { jsonrpc: '2.0', id, result: errorResult('project is required') }
        return {
          jsonrpc: '2.0',
          id,
          result: textResult(getWorkspaceDetails(catalog, findWorkspace(catalog, project)))
        }
      }
      if (params.name === 'list_commands') {
        const project = stringArg(args, 'project')
        if (!project) return { jsonrpc: '2.0', id, result: errorResult('project is required') }
        return {
          jsonrpc: '2.0',
          id,
          result: textResult(listWorkspaceCommandsIn(findWorkspace(catalog, project), stringArg(args, 'worktree')))
        }
      }
      if (params.name === 'run_command') {
        const command = stringArg(args, 'command')
        if (!command) return { jsonrpc: '2.0', id, result: errorResult('command is required') }
        const timeoutMs = numberArg(args, 'timeoutMs') ?? DEFAULT_RUN_TIMEOUT_MS
        if (timeoutMs < 0) return { jsonrpc: '2.0', id, result: errorResult('timeoutMs must be 0 or greater') }
        const resolved = resolveRunnable(catalog, {
          project: stringArg(args, 'project'),
          command,
          worktree: stringArg(args, 'worktree')
        })
        const result = await executeRunPlan(resolved.plan, {
          preferredShell: catalog.preferredShell,
    nodeCaCertificate: catalog.nodeCaCertificate,
          timeoutMs,
          dryRun: booleanArg(args, 'dryRun')
        })
        return {
          jsonrpc: '2.0',
          id,
          result: textResult({
            project: { id: resolved.workspace.id, name: resolved.workspace.name, rootPath: resolved.workspace.rootPath },
            command: { id: resolved.command.id, title: resolved.command.title, kind: resolved.command.kind },
            ...result
          }, result.exitCode !== 0)
        }
      }
      return { jsonrpc: '2.0', id, result: errorResult(`Unknown tool: ${params.name ?? '(missing)'}`) }
    } catch (error) {
      return { jsonrpc: '2.0', id, result: errorResult(error) }
    }
  }

  if (id === undefined || id === null) return null

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  }
}

export async function startMcpServer(options: McpOptions = {}) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let request: JsonRpcRequest
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      })}\n`)
      continue
    }

    const response = await handleMcpRequest(request, options)
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  }
}
