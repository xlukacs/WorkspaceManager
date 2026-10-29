import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAppCliServer } from './appCliServer'
import { callRunningApp, runningAppAvailable } from '@agent/appClient'

const directories: string[] = []
const servers: Awaited<ReturnType<typeof startAppCliServer>>[] = []
afterEach(() => { vi.unstubAllEnvs(); servers.splice(0).forEach((server) => server.close()); directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })) })
async function start(handle: Parameters<typeof startAppCliServer>[0]['handle'] = async (request) => request.action, storeFile = 'workspace-manager.json') {
  const directory = mkdtempSync(join(tmpdir(), 'wsm-cli-')); directories.push(directory)
  const server = await startAppCliServer({ directory, storePath: join(directory, storeFile), handle }); servers.push(server); return server
}
function raw(port: number, payload: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(payload))
    let output = ''
    socket.on('data', (data) => { output += data.toString() })
    socket.on('end', () => { socket.destroy(); resolve(output) })
    socket.on('error', reject)
  })
}
describe('running app CLI protocol', () => {
  it('authenticates, uses a private endpoint file, and removes it on close', async () => {
    const server = await start()
    expect(JSON.parse(readFileSync(server.endpointPath, 'utf8'))).toEqual(server.endpoint)
    if (process.platform !== 'win32') expect(statSync(server.endpointPath).mode & 0o777).toBe(0o600)
    expect(await callRunningApp({ action: 'ping' }, { endpointPath: server.endpointPath })).toBe('ping')
    expect(await runningAppAvailable({ endpointPath: server.endpointPath })).toBe(true)
    server.close()
    expect(existsSync(server.endpointPath)).toBe(false)
    await expect(callRunningApp({ action: 'ping' }, { endpointPath: server.endpointPath })).rejects.toThrow('Workspace Manager is not running')
  })
  it('rejects bad tokens, malformed JSON and oversized requests without invoking a handler', async () => {
    let calls = 0
    const server = await start(async () => { calls++; return null })
    expect(await raw(server.endpoint.port, JSON.stringify({ token: 'bad', request: { action: 'ping' } }) + '\n')).toContain('Invalid token')
    expect(await raw(server.endpoint.port, '{oops\n')).toContain('ok":false')
    expect(await raw(server.endpoint.port, 'x'.repeat(65 * 1024))).toContain('64 KiB')
    expect(calls).toBe(0)
  })
  it('serializes concurrent actions and continues after handler failures', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const entry = new Promise<void>((resolve) => { entered = resolve })
    const server = await start(async (request) => {
      order.push(request.action)
      if (request.action === 'add') { entered(); await gate; throw new Error('Scan failed') }
      return request.action
    })
    const options = { endpointPath: server.endpointPath }
    const first = callRunningApp({ action: 'add' }, options).catch((error: Error) => error.message)
    await entry
    const second = callRunningApp({ action: 'sessions' }, options)
    release()
    expect(await first).toBe('Scan failed')
    expect(await second).toBe('sessions')
    expect(order).toEqual(['add', 'sessions'])
  })
  it('preserves Unicode output across multiple TCP chunks', async () => {
    const output = 'console 😀\n'.repeat(15000)
    const server = await start(async () => output)
    expect(await callRunningApp({ action: 'output' }, { endpointPath: server.endpointPath })).toBe(output)
  })
  it('bounds client waits for an unresponsive handler', async () => {
    let release!: () => void
    const server = await start(async () => new Promise<void>((resolve) => { release = resolve }))
    await expect(callRunningApp({ action: 'ping' }, { endpointPath: server.endpointPath, timeoutMs: 30 })).rejects.toThrow('timed out')
    release()
  })

  it('rejects another store file in the same directory before dispatching an action', async () => {
    let calls = 0
    const server = await start(async () => { calls++; return null })
    const otherStore = join(directories[0]!, 'other.json')
    writeFileSync(otherStore, '{}')
    await expect(callRunningApp({ action: 'add', cwd: directories[0] }, { storePath: otherStore })).rejects.toThrow('different store')
    expect(await runningAppAvailable({ storePath: otherStore })).toBe(false)
    expect(calls).toBe(0)
    expect(await raw(server.endpoint.port, JSON.stringify({ token: server.endpoint.token, storePath: otherStore, request: { action: 'add' } }) + '\n')).toContain('different store')
    expect(calls).toBe(0)
  })

  it('checks the server store even when endpoint metadata was replaced', async () => {
    let calls = 0
    const server = await start(async () => { calls++; return null })
    const otherStore = join(directories[0]!, 'other.json')
    writeFileSync(server.endpointPath, JSON.stringify({ ...server.endpoint, storePath: otherStore }))
    await expect(callRunningApp({ action: 'add' }, { storePath: otherStore })).rejects.toThrow('different store')
    expect(calls).toBe(0)
  })

  it('rejects legacy endpoint metadata without a store identity', async () => {
    const server = await start()
    writeFileSync(server.endpointPath, JSON.stringify({ port: server.endpoint.port, token: server.endpoint.token }))
    await expect(callRunningApp({ action: 'ping' }, { endpointPath: server.endpointPath })).rejects.toThrow('Workspace Manager is not running')
  })

  it.runIf(process.platform !== 'win32')('accepts a symlink to the same store file', async () => {
    const server = await start()
    const storePath = join(directories[0]!, 'workspace-manager.json')
    const aliases = mkdtempSync(join(tmpdir(), 'wsm-store-alias-')); directories.push(aliases)
    const aliasPath = join(aliases, 'alias.json')
    writeFileSync(storePath, '{}')
    expect(server.endpoint.storePath).toBe(storePath)
    symlinkSync(storePath, aliasPath)
    expect(await callRunningApp({ action: 'ping' }, { storePath: aliasPath })).toBe('ping')
  })

  it('uses the actual custom store filename and honors environment selection', async () => {
    const server = await start(undefined, 'custom.json')
    expect(server.endpoint.storePath).toBe(join(directories[0]!, 'custom.json'))
    vi.stubEnv('WORKSPACE_MANAGER_STORE', server.endpoint.storePath)
    expect(await callRunningApp({ action: 'ping' })).toBe('ping')
    vi.stubEnv('WORKSPACE_MANAGER_STORE', join(directories[0]!, 'other.json'))
    await expect(callRunningApp({ action: 'add' })).rejects.toThrow('different store')
    expect(await callRunningApp({ action: 'ping' }, { storePath: server.endpoint.storePath })).toBe('ping')
  })

  it('skips a stale profile endpoint and uses the live app', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wsm-profiles-')); directories.push(root)
    const staleDir = join(root, 'workspace-manager')
    const liveDir = join(root, 'Workspace Manager')
    mkdirSync(staleDir)
    writeFileSync(join(staleDir, 'cli.json'), JSON.stringify({
      port: 1, token: 'a'.repeat(64), storePath: join(staleDir, 'workspace-manager.json')
    }))
    const server = await startAppCliServer({
      directory: liveDir, storePath: join(liveDir, 'workspace-manager.json'), handle: async (request) => request.action
    })
    servers.push(server)
    vi.stubEnv('XDG_CONFIG_HOME', root)
    vi.stubEnv('APPDATA', root)
    expect(await callRunningApp({ action: 'ping' })).toBe('ping')
  })

  it('prefers the installer profile when more than one app endpoint is live', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wsm-profiles-')); directories.push(root)
    const installed = await startAppCliServer({
      directory: join(root, 'workspace-manager'), storePath: join(root, 'workspace-manager', 'workspace-manager.json'),
      handle: async () => 'installed'
    })
    const leftover = await startAppCliServer({
      directory: join(root, 'Workspace Manager'), storePath: join(root, 'Workspace Manager', 'workspace-manager.json'),
      handle: async () => 'leftover'
    })
    servers.push(installed, leftover)
    vi.stubEnv('XDG_CONFIG_HOME', root)
    vi.stubEnv('APPDATA', root)
    expect(await callRunningApp({ action: 'ping' })).toBe('installed')
  })
})
