export const BOOLEAN_FLAGS = new Set(['json', 'help', 'dry-run', 'http', 'running', 'wait'])
export const VALUE_FLAGS = new Set(['collection', 'project', 'workspace', 'group', 'name', 'cwd', 'label', 'session', 'command', 'worktree', 'timeout', 'store', 'host', 'port', 'token', 'listen', 'allowed-origins', 'lease', 'lease-ms'])

export interface ParsedCli {
  command: string
  positionals: string[]
  flags: Record<string, string | boolean>
  trailing: string[]
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const fromNode = argv[0] === 'node' || Boolean(argv[0]?.split(/[\\/]/).at(-1)?.startsWith('node'))
  const args = fromNode ? argv.slice(2) : argv.slice()
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  let trailing: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      trailing = args.slice(index + 1)
      positionals.push(...trailing)
      break
    }
    if (arg === '-h' || arg === '--help') {
      flags.help = true
      continue
    }
    if (arg === '-j' || arg === '--json') {
      flags.json = true
      continue
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const trimmed = arg.slice(2)
    const eq = trimmed.indexOf('=')
    const key = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).toLowerCase()
    const inline = eq >= 0 ? trimmed.slice(eq + 1) : undefined

    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = inline === undefined ? true : inline !== 'false'
      continue
    }

    if (VALUE_FLAGS.has(key)) {
      const value = inline ?? args[index + 1]
      if (inline === undefined) index += 1
      if (!value || value.startsWith('-')) {
        throw new Error(`Flag --${key} requires a value.`)
      }
      flags[key] = value
      continue
    }

    throw new Error(`Unknown flag --${key}.`)
  }

  const command = flags.help && positionals.length === 0 ? 'help' : (positionals[0] ?? 'help')
  return {
    command,
    positionals: positionals.slice(command === positionals[0] ? 1 : 0),
    flags, trailing
  }
}

export function flagString(flags: Record<string, string | boolean>, key: string) {
  const value = flags[key]
  return typeof value === 'string' ? value : undefined
}

export function flagBoolean(flags: Record<string, string | boolean>, key: string) {
  return flags[key] === true
}

export const CLI_HELP = `Workspace Manager CLI — inspect workspaces and run their commands.

Usage:
  workspace-manager list [--collection <name>] [--json]
  workspace-manager show <workspace> [--json]
  workspace-manager commands <workspace> [--worktree <path|branch>] [--json]
  workspace-manager run <command-id> [--worktree <path|branch>] [--timeout <ms>] [--dry-run] [--json]
  workspace-manager run <workspace> <command> [--worktree <path|branch>] [--timeout <ms>] [--dry-run] [--json]
  workspace-manager lease|queue [help]
  workspace-manager acquire <workspace> --lease-ms <ms> [--wait] [--json]
  workspace-manager acquire --group <name> --lease-ms <ms> [--wait] [--json]
  workspace-manager lease-status|release <lease-id> [--json]
  workspace-manager renew <lease-id> --lease-ms <ms> [--json]
  workspace-manager lease acquire <workspace|--group <name>> --lease-ms <ms> [--wait] [--json]
  workspace-manager lease status|renew|release <lease-id> [--json]
  workspace-manager add <path> [--group <name>] [--name <name>]
  workspace-manager start <workspace> <command> [--worktree <path|branch>] [--lease <id> | --wait --lease-ms <ms>]
  workspace-manager start --cwd <dir> [--label <label>] -- <command...>
  workspace-manager sessions [--workspace <name>] [--group <name>] [--running] [--json]
  workspace-manager stop <session-id> | stop --workspace <name> | stop --group <name>
  workspace-manager pause|resume --workspace <name> | --group <name>
  workspace-manager kill-all
  workspace-manager focus [<workspace>] [--session <id>]
  workspace-manager worktrees <workspace> [--json]
  workspace-manager store-path
  workspace-manager mcp
  workspace-manager mcp --http [--host <addr>] [--port <n>] [--token <secret>]
  workspace-manager help

run uses the running app to coordinate execution, waits and returns the exit code.
start hands off to the running app and prints the GUI console session id.
run/add/start/sessions/stop/pause/resume/kill-all/focus and lease commands require the running app.
Use acquire --wait to wait in FIFO order. Pass --lease <id> to control the reserved group.
Release or expiry stops group consoles before the next agent starts. Renewals cannot exceed 10 minutes total. Read-only inspection stays available.

Workspace can be a workspace id, name, or root path.
Command can be a full command id (workspace::root::dev), a script name,
a docker title (e.g. "Compose Up"), or a Run action description.

Options:
  --lease <id>               Ownership token (or set WORKSPACE_MANAGER_LEASE)
  --lease-ms <ms>            Required when acquiring/renewing; 1–600000 ms (maximum 10 minutes)
  --wait                     Queue acquire/start/run until exclusive ownership starts; progress goes to stderr
  --store <path>             Store JSON (or set WORKSPACE_MANAGER_STORE)
  --collection <name>        Filter list by group (legacy flag name)
  --worktree <path|branch>   Run (or list cwds) in a git worktree (checkout path or branch name)
  --timeout <ms>             Kill the run after this many ms (default 120000, 0 = none)
  --dry-run                  Print the resolved plan without executing
  --json                     Machine-readable output
  --http                     Serve MCP over Streamable HTTP instead of stdio
  --listen <host:port>       HTTP bind address (default 127.0.0.1:3847)
  --host <addr>              HTTP bind host
  --port <n>                 HTTP bind port
  --token <secret>           Require Authorization: Bearer <secret> on HTTP MCP
  --allowed-origins <a,b>    Browser origins allowed to call HTTP MCP (default: none)
  --help                     Show this help

Environment leases:
  One active lease per workspace group; its workspaces and worktrees share a FIFO queue.
  Ungrouped workspaces each have their own queue.
  Supply --lease-ms explicitly: 1–600000 ms (maximum 10 minutes), with no default.
  The countdown starts when ownership is granted; time spent queued does not count.
  Pass --lease <id> on controls, or set WORKSPACE_MANAGER_LEASE.
  Release early when finished. Otherwise expiry automatically aborts headless runs,
  stops group consoles, and admits the next waiter after cleanup.
  Renewal cannot extend ownership beyond 10 minutes from the original start.
  --wait reports "Environment queued" and "Environment started" to stderr.
  Without --wait, acquire --json returns queued/started; poll lease-status until started.
  release also cancels a queued lease; Ctrl+C cancels a CLI waiter.

  wsm lease and wsm queue print this help. Subcommands: acquire, status, renew, release.

  Example (wsm is the workspace-manager alias):
    lease=$(wsm acquire --group Services --lease-ms 600000 --wait)
    wsm start api dev --lease "$lease"
    wsm run api build --lease "$lease"
    wsm release "$lease"

  Queue and launch automatically:
    wsm start api dev --wait --lease-ms 600000 --json
  start returns sessionId and lease in JSON; keep the lease for subsequent controls.
  start keeps ownership until release/expiry, even if its console exits.
    wsm run api build --wait --lease-ms 600000
  run releases its temporary lease automatically when the command finishes.
  Leases and queued reservations reset when the desktop app restarts.

MCP:
  stdio:  workspace-manager mcp
  HTTP:   workspace-manager mcp --http   (agents connect to http://127.0.0.1:3847/mcp)
  Docker: docker compose up -d
  Deb:    systemctl --user enable --now workspace-manager-mcp
`

const LEASE_SUBCOMMANDS: Record<string, string> = {
  acquire: 'acquire',
  status: 'lease-status',
  'lease-status': 'lease-status',
  renew: 'renew',
  release: 'release',
  help: 'help'
}

export function rewriteLeaseAlias(parsed: ParsedCli): ParsedCli {
  if (parsed.command !== 'lease' && parsed.command !== 'queue') return parsed
  const sub = parsed.positionals[0]
  if (!sub || sub === 'help') return { ...parsed, command: 'help', positionals: [] }
  const command = LEASE_SUBCOMMANDS[sub]
  if (!command) throw new Error(`Unknown lease command: ${sub}\n${CLI_HELP}`)
  return { ...parsed, command, positionals: parsed.positionals.slice(1) }
}
