import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { candidateStorePaths } from './loadStore'
import { APP_CLI_MAX_REQUEST_BYTES, APP_CLI_TIMEOUT_MS, type AppCliEndpoint, type AppCliRequest, type AppCliResponse } from '@shared/appCli'
import { canonicalAppStorePath, sameAppStorePath } from '@shared/appCliStorePath'

export class AppNotRunningError extends Error {
  constructor() { super('Workspace Manager is not running'); this.name = 'AppNotRunningError' }
}
export interface AppClientOptions { storePath?: string | null; endpointPath?: string; timeoutMs?: number }

function readEndpoint(options: AppClientOptions) {
  const selectedStore = options.storePath ?? process.env.WORKSPACE_MANAGER_STORE
  const candidates = options.endpointPath ? [{ path: options.endpointPath, store: selectedStore }]
    : (selectedStore ? [selectedStore] : candidateStorePaths()).map((store) => ({ path: join(dirname(canonicalAppStorePath(store)), 'cli.json'), store }))
  const candidate = candidates.find(({ path }) => existsSync(path))
  if (!candidate) throw new AppNotRunningError()
  let endpoint: AppCliEndpoint
  try {
    endpoint = JSON.parse(readFileSync(candidate.path, 'utf8')) as AppCliEndpoint
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== 'string'
      || typeof endpoint.storePath !== 'string' || !endpoint.storePath) throw new Error()
  } catch { throw new AppNotRunningError() }
  const storePath = canonicalAppStorePath(candidate.store ?? endpoint.storePath)
  if (!sameAppStorePath(storePath, endpoint.storePath)) throw new Error('Running Workspace Manager uses a different store.')
  return { ...endpoint, storePath }
}

export async function callRunningApp(request: AppCliRequest, options: AppClientOptions = {}): Promise<unknown> {
  const endpoint = readEndpoint(options)
  const payload = Buffer.from(JSON.stringify({ token: endpoint.token, storePath: endpoint.storePath, request }) + '\n')
  if (payload.length > APP_CLI_MAX_REQUEST_BYTES) throw new Error('Request exceeds 64 KiB.')
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint.port, '127.0.0.1')
    let settled = false
    let buffer = Buffer.alloc(0)
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    socket.setTimeout(options.timeoutMs ?? APP_CLI_TIMEOUT_MS, () => finish(new Error('App request timed out.')))
    socket.once('connect', () => socket.write(payload))
    socket.on('error', () => finish(new AppNotRunningError()))
    socket.once('close', () => { if (!settled) finish(new AppNotRunningError()) })
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      if (buffer.length > 1024 * 1024) { finish(new Error('App response exceeds 1 MiB.')); return }
      if (!buffer.includes(10)) return
      try {
        const response = JSON.parse(buffer.subarray(0, buffer.indexOf(10)).toString('utf8')) as AppCliResponse
        if (!response.ok) finish(new Error(response.error))
        else finish(undefined, response.result)
      } catch { finish(new Error('Invalid app response.')) }
    })
  })
}

export async function runningAppAvailable(options: AppClientOptions = {}) {
  try { await callRunningApp({ action: 'ping' }, { ...options, timeoutMs: 1000 }); return true }
  catch { return false }
}
