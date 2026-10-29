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

function locationKey(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function endpointLocations(options: AppClientOptions) {
  const selectedStore = options.storePath ?? process.env.WORKSPACE_MANAGER_STORE
  const seen = new Set<string>()
  const locations: Array<{ path: string; store?: string }> = []
  const add = (path: string, store?: string) => {
    const key = locationKey(path)
    if (seen.has(key)) return
    seen.add(key)
    locations.push({ path, store })
  }
  if (options.endpointPath) add(options.endpointPath, selectedStore)
  else for (const store of selectedStore ? [selectedStore] : candidateStorePaths()) {
    add(join(dirname(canonicalAppStorePath(store)), 'cli.json'), store)
  }
  return { selectedStore, locations }
}

function loadEndpoint(path: string) {
  if (!existsSync(path)) return null
  try {
    const endpoint = JSON.parse(readFileSync(path, 'utf8')) as AppCliEndpoint
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== 'string'
      || typeof endpoint.storePath !== 'string' || !endpoint.storePath) return null
    return endpoint
  } catch { return null }
}

function dispatch(request: AppCliRequest, endpoint: AppCliEndpoint, timeoutMs: number | undefined) {
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
    socket.setTimeout(timeoutMs ?? APP_CLI_TIMEOUT_MS, () => finish(new Error('App request timed out.')))
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

export async function callRunningApp(request: AppCliRequest, options: AppClientOptions = {}): Promise<unknown> {
  const { selectedStore, locations } = endpointLocations(options)
  let differentStore = false
  for (const location of locations) {
    const endpoint = loadEndpoint(location.path)
    if (!endpoint) continue
    const storePath = canonicalAppStorePath(location.store ?? endpoint.storePath)
    if (!sameAppStorePath(storePath, endpoint.storePath)) {
      differentStore = true
      continue
    }
    try { return await dispatch(request, { ...endpoint, storePath }, options.timeoutMs) }
    catch (error) {
      if (error instanceof AppNotRunningError) continue
      throw error
    }
  }
  if (differentStore && selectedStore) throw new Error('Running Workspace Manager uses a different store.')
  throw new AppNotRunningError()
}

export async function runningAppAvailable(options: AppClientOptions = {}) {
  try { await callRunningApp({ action: 'ping' }, { ...options, timeoutMs: 1000 }); return true }
  catch { return false }
}
