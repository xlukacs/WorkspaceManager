# Agent notes

Use `pnpm`. Never `npm`.

## Setup

```bash
pnpm install
```

## Checks

```bash
pnpm test
pnpm typecheck
```

## Run

```bash
pnpm dev              # Electron app
pnpm web              # browser UI preview
pnpm wsm -- --help    # CLI (builds, then runs)
pnpm mcp              # stdio MCP
pnpm mcp:http         # HTTP MCP on 127.0.0.1:3847
```

## Layout

- `src/main` — Electron main process, store, PTY
- `src/renderer` — React UI
- `src/agent` — CLI and MCP
- `src/shared` — types and pure helpers

## Guardrails

- Do not commit `.env`. Copy `.env.example`.
- HTTP MCP can run local project commands. Keep it on `127.0.0.1`. Set `MCP_TOKEN` if you bind beyond loopback.
- App data lives in OS userData, not this repo.
