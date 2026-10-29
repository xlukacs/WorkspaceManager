import { callRunningApp } from './appClient'
import { resolve } from 'node:path'
import type { AppCliRequest } from '@shared/appCli'
import { CLI_HELP, flagBoolean, flagString, parseCliArgs } from '@agent/parseCli'
import {
  findWorkspace,
  getWorkspaceDetails,
  listWorkspaceCommandsIn,
  listWorkspaces,
  loadCatalog,
  resolveRunnable,
  type AgentCatalog,
  type WorkspaceSummary
} from '@agent/catalog'
import { DEFAULT_RUN_TIMEOUT_MS, executeRunPlan } from '@agent/runCommand'
import { startMcpServer } from '@agent/mcp'
import { resolveMcpHttpBind, startMcpHttpServer } from '@agent/mcpHttp'

export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
}

function printJson(io: CliIo, value: unknown) {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`)
}

function pad(value: string, width: number) {
  return value.length >= width ? `${value} ` : value.padEnd(width)
}

function formatWorkspaceRows(workspaces: WorkspaceSummary[]) {
  if (workspaces.length === 0) return 'No workspaces found.\n'
  const headers = ['NAME', 'BRANCH', 'PM', 'PATH']
  const rows = workspaces.map((workspace) => [
    workspace.name,
    workspace.branch ? `${workspace.branch}${workspace.isDirty ? '*' : ''}` : '-',
    workspace.packageManager,
    workspace.rootPath
  ])
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  )
  const line = (cells: string[]) => `${cells.map((cell, index) => pad(cell, widths[index] + 2)).join('').trimEnd()}\n`
  return `${line(headers)}${rows.map((row) => line(row)).join('')}`
}

function parseTimeout(value: string | undefined) {
  if (value === undefined) return DEFAULT_RUN_TIMEOUT_MS
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Timeout must be a non-negative integer (milliseconds).')
  return parsed
}

function loadCatalogFromFlags(flags: Record<string, string | boolean>) {
  return loadCatalog({ storePath: flagString(flags, 'store') })
}

function resolveRunInput(parsed: ReturnType<typeof parseCliArgs>) {
  const workspaceFlag = flagString(parsed.flags, 'project')
  const commandFlag = flagString(parsed.flags, 'command')
  if (commandFlag && workspaceFlag) {
    return { project: workspaceFlag, command: commandFlag }
  }
  if (commandFlag) return { project: workspaceFlag ?? parsed.positionals[0], command: commandFlag }
  if (parsed.positionals.length >= 2) {
    return { project: parsed.positionals[0], command: parsed.positionals.slice(1).join(' ') }
  }
  if (parsed.positionals.length === 1) {
    const only = parsed.positionals[0]
    if (only.includes('::')) return { project: workspaceFlag, command: only }
    if (workspaceFlag) return { project: workspaceFlag, command: only }
    throw new Error(`Usage: workspace-manager run ${only} <command>`)
  }
  throw new Error('Usage: workspace-manager run <command-id> | workspace-manager run <workspace> <command>')
}

async function runCommandAction(catalog: AgentCatalog, parsed: ReturnType<typeof parseCliArgs>, io: CliIo) {
  const input = resolveRunInput(parsed)
  const { workspace, command, plan } = resolveRunnable(catalog, {
    project: input.project,
    command: input.command,
    worktree: flagString(parsed.flags, 'worktree')
  })
  const json = flagBoolean(parsed.flags, 'json')
  const dryRun = flagBoolean(parsed.flags, 'dry-run')
  const result = await executeRunPlan(plan, {
    preferredShell: catalog.preferredShell,
    nodeCaCertificate: catalog.nodeCaCertificate,
    timeoutMs: parseTimeout(flagString(parsed.flags, 'timeout')),
    dryRun,
    onChunk: json ? undefined : (chunk) => io.stdout(chunk)
  })
  const payload = {
    project: { id: workspace.id, name: workspace.name, rootPath: workspace.rootPath },
    command: { id: command.id, title: command.title, kind: command.kind },
    dryRun,
    ...result
  }
  if (json) printJson(io, payload)
  else if (dryRun) {
    io.stdout(`${result.title}  ${result.commandId}  (dry run)\n`)
    for (const step of result.steps) io.stdout(`$ ${step.shellLine}\n  cwd ${step.cwd}\n`)
  } else if (result.timedOut) {
    io.stderr(`Command timed out after the configured limit. Use --timeout 0 to wait indefinitely.\n`)
  }
  return result.exitCode
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const parsed = parseCliArgs(argv)
    if (parsed.command === 'help' || flagBoolean(parsed.flags, 'help')) {
      io.stdout(CLI_HELP)
      return 0
    }

    if (parsed.command === 'mcp') {
      const storePath = flagString(parsed.flags, 'store')
      const http = flagBoolean(parsed.flags, 'http')
        || Boolean(flagString(parsed.flags, 'listen'))
        || Boolean(flagString(parsed.flags, 'host'))
        || Boolean(flagString(parsed.flags, 'port'))
        || process.env.MCP_HTTP === '1'
      if (http) {
        const bind = resolveMcpHttpBind({ flags: parsed.flags })
        if (!bind.token) {
          io.stderr('Warning: no --token set; any process that can reach this server can call run_command.\n')
        }
        const server = await startMcpHttpServer({
          ...bind,
          storePath,
          onListening: (listening) => {
            io.stderr(`MCP HTTP listening at ${listening.url}\n`)
          }
        })
        const stop = () => {
          void server.close()
        }
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
        await server.closed
        return 0
      }
      await startMcpServer({ storePath })
      return 0
    }

    if (['add', 'start', 'sessions', 'stop', 'pause', 'resume', 'kill-all', 'focus'].includes(parsed.command)) {
      const request: AppCliRequest = {
        action: parsed.command as AppCliRequest['action'],
        workspace: flagString(parsed.flags, 'workspace'), group: flagString(parsed.flags, 'group'),
        name: flagString(parsed.flags, 'name'), label: flagString(parsed.flags, 'label'),
        worktree: flagString(parsed.flags, 'worktree'), sessionId: flagString(parsed.flags, 'session'),
        running: flagBoolean(parsed.flags, 'running')
      }
      if (parsed.command === 'add') {
        if (!parsed.positionals[0]) throw new Error('Usage: wsm add <path> [--group <name>] [--name <name>]')
        request.cwd = resolve(parsed.positionals[0])
      }
      if (parsed.command === 'start') {
        const cwd = flagString(parsed.flags, 'cwd')
        if (cwd) {
          if (!parsed.trailing.length) throw new Error('Usage: wsm start --cwd <dir> -- <command...>')
          request.cwd = resolve(cwd)
          request.argv = parsed.trailing
        } else {
          request.workspace = request.workspace ?? parsed.positionals[0]
          request.command = flagString(parsed.flags, 'command') ?? parsed.positionals.slice(1).join(' ')
          if (!request.workspace || !request.command) throw new Error('Usage: wsm start <workspace> <command>')
        }
      }
      if (parsed.command === 'stop') request.sessionId = request.sessionId ?? parsed.positionals[0]
      if (parsed.command === 'focus') request.workspace = request.workspace ?? parsed.positionals[0]
      const result = await callRunningApp(request, { storePath: flagString(parsed.flags, 'store') })
      if (flagBoolean(parsed.flags, 'json')) printJson(io, result)
      else if (parsed.command === 'start') io.stdout(`${(result as { sessionId: string }).sessionId}\n`)
      else if (parsed.command === 'sessions') {
        for (const session of result as Array<{ id: string; title: string; status: string; workspaceId: string; worktreePath: string | null }>) {
          io.stdout(`${session.id}  ${session.status.padEnd(8)} ${session.title}  ${session.workspaceId}  ${session.worktreePath ?? '-'}\n`)
        }
      } else printJson(io, result)
      return 0
    }
    if (parsed.command === 'worktrees') {
      if (!parsed.positionals[0]) throw new Error('Usage: wsm worktrees <workspace> [--json]')
      const catalog = loadCatalogFromFlags(parsed.flags)
      const worktrees = getWorkspaceDetails(catalog, findWorkspace(catalog, parsed.positionals[0])).worktrees
      if (flagBoolean(parsed.flags, 'json')) printJson(io, worktrees)
      else for (const tree of worktrees) io.stdout(`${tree.branch ?? '(detached)'}  ${tree.path}${tree.isMissing ? '  missing' : ''}\n`)
      return 0
    }

    if (parsed.command === 'store-path') {
      const catalog = loadCatalogFromFlags(parsed.flags)
      io.stdout(`${catalog.storePath}\n`)
      return 0
    }

    if (parsed.command === 'list') {
      const catalog = loadCatalogFromFlags(parsed.flags)
      const workspaces = listWorkspaces(catalog, flagString(parsed.flags, 'collection'))
      if (flagBoolean(parsed.flags, 'json')) printJson(io, workspaces)
      else io.stdout(formatWorkspaceRows(workspaces))
      return 0
    }

    if (parsed.command === 'show') {
      const query = parsed.positionals[0] ?? flagString(parsed.flags, 'project')
      if (!query) throw new Error('Usage: workspace-manager show <workspace>')
      const catalog = loadCatalogFromFlags(parsed.flags)
      const details = getWorkspaceDetails(catalog, findWorkspace(catalog, query))
      if (flagBoolean(parsed.flags, 'json')) printJson(io, details)
      else {
        io.stdout(`${details.name}  ${details.id}\n${details.rootPath}\n`)
        io.stdout(`branch  ${details.branch ?? '-'}${details.isDirty ? ' *' : ''}\n`)
        io.stdout(`groups  ${details.collections.join(', ') || '-'}\n`)
        io.stdout(`package  ${details.packageManager}${details.isMonorepo ? '  monorepo' : ''}\n`)
        if (details.worktrees.length > 0) {
          io.stdout('worktrees\n')
          for (const worktree of details.worktrees) {
            io.stdout(`  ${worktree.branch ?? '(detached)'}  ${worktree.path}${worktree.isMain ? '  main' : ''}\n`)
          }
        }
        if (details.runActions.length > 0) {
          io.stdout('run actions\n')
          for (const action of details.runActions) {
            io.stdout(`  ${action.description}${action.default ? '  (default)' : ''}  ${action.command}\n`)
          }
        }
      }
      return 0
    }

    if (parsed.command === 'commands') {
      const query = parsed.positionals[0] ?? flagString(parsed.flags, 'project')
      if (!query) throw new Error('Usage: workspace-manager commands <workspace>')
      const catalog = loadCatalogFromFlags(parsed.flags)
      const workspace = findWorkspace(catalog, query)
      const commands = listWorkspaceCommandsIn(workspace, flagString(parsed.flags, 'worktree'))
      if (flagBoolean(parsed.flags, 'json')) printJson(io, commands)
      else {
        if (commands.length === 0) io.stdout('No commands found.\n')
        for (const command of commands) {
          const mark = command.favorite ? '*' : ' '
          io.stdout(`${mark} ${command.kind.padEnd(11)} ${command.title.padEnd(24)} ${command.id}\n`)
        }
      }
      return 0
    }

    if (parsed.command === 'run') {
      resolveRunInput(parsed)
      const catalog = loadCatalogFromFlags(parsed.flags)
      return await runCommandAction(catalog, parsed, io)
    }

    throw new Error(`Unknown command: ${parsed.command}\n${CLI_HELP}`)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
