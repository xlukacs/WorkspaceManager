import { afterEach, describe, expect, it } from 'vitest'
import { catalogFromState } from '@agent/catalog'
import { parseListenAddress, resolveMcpHttpBind, startMcpHttpServer, type McpHttpServer } from '@agent/mcpHttp'
import type { LegacyWorkspaceRecord, LegacyState } from '@shared/types'

const catalog = catalogFromState({
  version: 11,
  groups: [{ id: 'active', name: 'Active', order: 0 }],
  workspaces: [{
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
    gitSummary: null,
    gitWorktrees: [],
    gitWorktreesRoot: null
  } satisfies LegacyWorkspaceRecord],
  terminals: [],
  settings: { preferredShell: 'bash' }
} satisfies LegacyState, '/tmp/store.json')

const servers: McpHttpServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  })
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>
  }
}

describe('MCP HTTP bind parsing', () => {
  it('parses host:port, port-only, and env defaults', () => {
    expect(parseListenAddress('0.0.0.0:3847')).toEqual({ host: '0.0.0.0', port: 3847 })
    expect(parseListenAddress('4000', '10.0.0.1')).toEqual({ host: '10.0.0.1', port: 4000 })
    expect(resolveMcpHttpBind({
      flags: { http: true },
      env: { MCP_HOST: '0.0.0.0', MCP_PORT: '9999', MCP_TOKEN: 'secret' }
    })).toEqual({ host: '0.0.0.0', port: 9999, token: 'secret' })
    expect(resolveMcpHttpBind({
      flags: {},
      env: { MCP_ALLOWED_ORIGINS: 'http://localhost:6274/, https://Tool.example' }
    }).allowedOrigins).toEqual(['http://localhost:6274', 'https://tool.example'])
  })
})

describe('MCP HTTP server', () => {
  it('serves health, initialize, and tools over Streamable HTTP', async () => {
    const server = await startMcpHttpServer({
      host: '127.0.0.1',
      port: 0,
      catalogLoader: () => catalog
    })
    servers.push(server)

    const health = await fetch(`http://127.0.0.1:${server.port}/health`)
    expect(health.ok).toBe(true)
    expect(await health.json()).toMatchObject({ ok: true, mcp: '/mcp' })

    const initialized = await post(server.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    })
    expect(initialized.status).toBe(200)
    expect(initialized.json).toMatchObject({
      result: { serverInfo: { name: 'workspace-manager' } }
    })

    const listed = await post(server.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (listed.json.result as { tools: Array<{ name: string }> }).tools
    expect(tools.map((tool) => tool.name)).toContain('list_workspaces')
  })

  it('rejects HTTP requests without the configured bearer token', async () => {
    const server = await startMcpHttpServer({
      host: '127.0.0.1',
      port: 0,
      token: 's3cret',
      catalogLoader: () => catalog
    })
    servers.push(server)

    const denied = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(denied.status).toBe(401)

    const health = await fetch(`http://127.0.0.1:${server.port}/health`)
    expect(health.ok).toBe(true)

    const allowed = await post(server.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, {
      Authorization: 'Bearer s3cret'
    })
    expect(allowed.status).toBe(200)
  })

  it('refuses browser requests from origins that are not allowed', async () => {
    const server = await startMcpHttpServer({
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: ['http://localhost:6274'],
      catalogLoader: () => catalog
    })
    servers.push(server)
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_workspaces', arguments: {} } }

    const foreign = await post(server.url, call, { Origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
    expect(JSON.stringify(foreign.json)).not.toContain('demo')

    // A CORS "simple request" a page can send without a preflight.
    const simple = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(call) })
    expect(simple.status).toBe(415)

    const preflight = await fetch(server.url, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    expect(preflight.status).toBe(403)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

    expect((await post(server.url, call, { Origin: 'http://localhost:6274' })).status).toBe(200)
  })

  it('is stateless: no sessions, no standalone SSE stream, 202 for notifications', async () => {
    const server = await startMcpHttpServer({ host: '127.0.0.1', port: 0, catalogLoader: () => catalog })
    servers.push(server)

    const get = await fetch(server.url, { headers: { Accept: 'text/event-stream' } })
    expect(get.status).toBe(405)
    expect((await fetch(`http://127.0.0.1:${server.port}/sse`)).status).toBe(404)

    const notification = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
    expect(notification.status).toBe(202)
    expect(notification.headers.get('mcp-session-id')).toBeNull()
  })

  it('answers SSE-only clients with an event stream and rejects oversized bodies', async () => {
    const server = await startMcpHttpServer({ host: '127.0.0.1', port: 0, catalogLoader: () => catalog })
    servers.push(server)

    const sse = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    })
    expect(sse.headers.get('content-type')).toContain('text/event-stream')
    expect(await sse.text()).toBe('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n')

    const huge = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'a'.repeat(3 * 1024 * 1024)
    }).catch(() => null)
    if (huge) expect(huge.status).toBe(413)
  })
})
