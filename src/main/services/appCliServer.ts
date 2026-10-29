import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { APP_CLI_MAX_REQUEST_BYTES, APP_CLI_TIMEOUT_MS, type AppCliEndpoint, type AppCliRequest, type AppCliResponse } from '@shared/appCli'
import { canonicalAppStorePath, sameAppStorePath } from '@shared/appCliStorePath'

export async function startAppCliServer(options: {
  directory: string
  storePath?: string
  handle: ((request: AppCliRequest, signal?: AbortSignal) => Promise<unknown>) & { dispose?: () => void }
  timeoutMs?: number
}) {
  const token = randomBytes(32).toString('hex')
  const storePath = canonicalAppStorePath(options.storePath ?? join(options.directory, 'workspace-manager.json'))
  const endpointPath = join(options.directory, 'cli.json')
  const sockets = new Set<Socket>()
  let queue = Promise.resolve()
  const server = createServer((socket) => {
    const disconnected = new AbortController()
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket); disconnected.abort() })
    socket.on('error', () => {})
    socket.setTimeout(options.timeoutMs ?? APP_CLI_TIMEOUT_MS, () => socket.destroy())
    let buffer = Buffer.alloc(0)
    let received = false
    const reply = (response: AppCliResponse) => {
      if (!socket.destroyed) socket.end(JSON.stringify(response) + '\n')
    }
    socket.on('data', (chunk) => {
      if (received) return
      if (buffer.length + chunk.length > APP_CLI_MAX_REQUEST_BYTES) {
        received = true
        reply({ ok: false, error: 'Request exceeds 64 KiB.' })
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      received = true
      try {
        if (buffer.subarray(newline + 1).toString().trim()) throw new Error('One request per connection is allowed.')
        const payload = JSON.parse(buffer.subarray(0, newline).toString('utf8')) as { token?: unknown; storePath?: unknown; request?: AppCliRequest }
        if (typeof payload.token !== 'string' || payload.token.length !== token.length || !timingSafeEqual(Buffer.from(payload.token), Buffer.from(token))) {
          throw new Error('Invalid token.')
        }
        if (typeof payload.storePath !== 'string' || !sameAppStorePath(payload.storePath, storePath)) {
          throw new Error('Running Workspace Manager uses a different store.')
        }
        if (!payload.request || typeof payload.request.action !== 'string') throw new Error('Invalid request.')
        const request = payload.request
        const dispatch = async () => {
          if (socket.destroyed) return
          if (request.action === 'run') socket.setTimeout(0)
          try { reply({ ok: true, result: await options.handle(request, disconnected.signal) }) }
          catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
        }
        // Runs pin their scope in the lease manager. Keep other groups and queue
        // management reachable while a long command executes.
        if (['run', 'lease-status', 'renew', 'release', 'ping'].includes(request.action)) void dispatch()
        else queue = queue.then(dispatch)
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  server.on('error', () => {})
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to bind the app CLI endpoint.')
  const endpoint: AppCliEndpoint = { port: address.port, token, storePath }
  const temporaryPath = `${endpointPath}.${token}.tmp`
  try {
    mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    writeFileSync(temporaryPath, JSON.stringify(endpoint), { mode: 0o600, flag: 'wx' })
    renameSync(temporaryPath, endpointPath)
  } catch (error) {
    server.close()
    rmSync(temporaryPath, { force: true })
    throw error
  }
  let closed = false
  return {
    endpoint,
    endpointPath,
    close() {
      if (closed) return
      closed = true
      options.handle.dispose?.()
      try {
        const current = JSON.parse(readFileSync(endpointPath, 'utf8')) as AppCliEndpoint
        if (current.token === token) rmSync(endpointPath, { force: true })
      } catch { /* Already removed, or replaced by another app instance. */ }
      for (const socket of sockets) socket.destroy()
      server.close()
    }
  }
}
