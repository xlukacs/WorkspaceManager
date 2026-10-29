# Workspace Manager

Electron app for managing local development workspaces.

## Development

Use `pnpm install` to install dependencies.

Use `pnpm dev` to run the Electron app in development mode.

Use `pnpm test` to run the test suite.

## Agent CLI and MCP

The same workspace catalog the app uses is available as a CLI and as an MCP server. Both read the Workspace Manager store (created when you open the app, or set `WORKSPACE_MANAGER_STORE`).

```bash
workspace-manager list
workspace-manager show demo
workspace-manager commands demo
workspace-manager run demo build
workspace-manager mcp --http
```

Commands can be a full id (`project::root::dev`), a unique script name, a docker title such as `Compose Up`, or a Run action description. Pass `--worktree <path|branch>` to run in one of the workspace's git worktrees; an unknown worktree is an error rather than a silent fallback to the main checkout. Long-running commands (`dev`, `watch`, compose up) are stopped after 120s unless you set `--timeout 0`.

Detected Node projects include an install helper using their own package manager
and folder in the selected checkout. An explicit `install` script takes its place.

### Install the CLI (.deb)

This is a separate package from the Electron app, named `workspace-manager-cli`, so you can install and upgrade it with dpkg:

```bash
pnpm build:cli-deb
sudo dpkg -i release/<version>/workspace-manager-cli_<version>_all.deb
```

`pnpm build:linux` also builds this deb next to the desktop app installer. Upgrade by installing a newer (or the same) `workspace-manager-cli_*.deb` the same way. The package depends on `nodejs` (>= 18) and puts `workspace-manager` and `wsm` on your PATH.

Start a local HTTP MCP server that uses your user store and host toolchain:

```bash
systemctl --user enable --now workspace-manager-mcp
```

That listens on `http://127.0.0.1:3847/mcp`. This is the best option for `run_command`, because it runs on the host.

### MCP over HTTP (agents connect by URL)

```json
{
  "mcpServers": {
    "workspace-manager": {
      "url": "http://127.0.0.1:3847/mcp"
    }
  }
}
```

Optional bearer token (`workspace-manager mcp --http --token <secret>` or `MCP_TOKEN`):

```json
{
  "mcpServers": {
    "workspace-manager": {
      "url": "http://127.0.0.1:3847/mcp",
      "headers": {
        "Authorization": "Bearer <secret>"
      }
    }
  }
}
```

stdio still works: `"command": "workspace-manager", "args": ["mcp"]`.

The HTTP server is stateless Streamable HTTP (POST `/mcp` only). It refuses any request that carries a browser `Origin` header, so a web page you visit cannot reach it and run commands. If you need a browser-based client, allow its origin with `--allowed-origins http://localhost:6274` or `MCP_ALLOWED_ORIGINS`.

Tools: `list_workspaces`, `get_workspace`, `list_commands`, `run_command`.

### MCP in Docker

Use this when you want a containerized HTTP endpoint. The compose file mounts the app's config directory (read-only, so the container sees every save the app makes) and the directory that contains your repos *at the same host path*, so project paths in the store still resolve.

```bash
cp .env.example .env
# edit WORKSPACE_MANAGER_CONFIG_DIR, WORKSPACES_HOST_PATH, and optionally MCP_TOKEN
pnpm mcp:docker
```

Agents still connect to `http://127.0.0.1:3847/mcp`. The port is published on `127.0.0.1` only; set `MCP_BIND=0.0.0.0` together with `MCP_TOKEN` if other machines need it. With Docker Desktop, both directories must be under a path listed in Settings → Resources → File sharing.

`run_command` only has the tools in the image (Node, npm, pnpm, git), and it writes to your real checkouts. Installing dependencies from the container leaves `node_modules` built for the container, not your host. Prefer the systemd user service on the host when agents need to install, build, or use the full local toolchain.

## Build Outputs

Use `pnpm build` to compile the Electron app into `out/` and the agent CLI into `out/cli/`.

Use `pnpm build:win` on Windows to package both an NSIS installer and a portable `.exe` into `release/<version>/`.

Use `pnpm build:linux` on Linux to package the desktop `.deb` and the CLI `.deb` into `release/<version>/`.

The **Verify packages** GitHub Actions workflow builds both platforms from the
same revision. Its Linux job runs the tests, installs both `.deb` packages and
exercises the packaged desktop/CLI. Its Windows job runs the NSIS installer,
checks both CLI aliases and user PATH, exercises the installed desktop with a
real PTY, then checks reinstall and uninstall cleanup. Successful jobs retain
their packages as workflow artifacts, named with the source revision.

Download both platforms' artifacts from one successful run when preparing a
release. Upgrade the Linux desktop and CLI together, then restart the desktop.
The workflow builds unsigned Windows packages and does not publish a release.
See [the integration plan](docs/integration-plan.md) for acceptance status.

## Windows Build Prerequisites

`pnpm build:win` uses `build/icon.ico`, generated from `src/assets/logo.png`. Linux packaging uses `build/icon.png`.

The Windows package path is built on top of the existing Electron bundle and packages the existing installed dependencies without forcing an extra native rebuild step.

`node-pty` is already installed as part of `pnpm install`, and this project now tells `electron-builder` to skip the additional rebuild pass that can fail on Windows machines missing the Spectre-mitigated MSVC libraries.

Build from Windows for the most reliable packaging result.

### Commands for the running app

`wsm run <workspace> <command>` runs headlessly, waits and returns an exit code.
`wsm start <workspace> <command>` hands off to the running desktop app and prints
its console session id. Use `wsm sessions --json`, `wsm stop <id>`,
`wsm pause --group <name>`, `wsm resume --workspace <name>`, `wsm kill-all`, and
`wsm focus --session <id>` to manage GUI consoles. `wsm add <path> --group <name>`
registers a folder, creating the group if needed. `wsm worktrees <workspace>`
also works with the app closed.

Stop commands and `wsm kill-all` keep console history and pins. The sidebar's
**Kill group consoles** action stops and removes all consoles in that group,
including finished consoles, history, pins and paused entries.

For arbitrary commands, use `wsm start --cwd <dir> -- <command...>`; the app
infers the owning workspace, registering the directory when needed. A single
argument after `--` is treated as shell text; multiple arguments are quoted for
the selected shell. Put CLI options such as `--store` before `--`.

MCP advertises `list_sessions`, `start_command`, `stop_session`, and
`get_session_output` when the desktop endpoint is reachable. Existing headless
tools stay available. The endpoint is loopback-only and authenticated by the
private `cli.json` beside the app store; it is removed on app exit. Discovery and
each request verify the canonical store filename, so `--store` cannot control
another catalog just because its file is in the same directory. Update the CLI
and restart the desktop app together when upgrading to this store-bound protocol;
old endpoint files without a store identity are rejected.

Windows setup installs `wsm.cmd` and `workspace-manager.cmd` on the user PATH,
using the bundled Electron runtime. On Linux, install both the desktop `.deb`
and the existing CLI `.deb` to use `wsm start` with the desktop app.

### Settings

Open Settings from the sidebar to choose a Node CA certificate, console shell,
external terminal, and default Open target. A workspace can override the Open
target; Open always uses its selected checkout. Console preferences apply to
new starts and restarts, and the CA setting also applies to headless CLI/MCP
runs. Settings and navigation are saved in the app store. The dialog includes
the keyboard shortcuts reference. Unexpected renderer and asynchronous errors
show Retry and Reload controls.
