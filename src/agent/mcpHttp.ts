import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { DEFAULT_MCP_PORT, handleMcpRequest, type JsonRpcRequest, type McpOptions } from '@agent/mcp'

const MAX_BODY_BYTES = 2 * 1024 * 1024

export interface McpHttpBind {
  host: string
  port: number
  token?: string
  allowedOrigins?: string[]
}

export interface McpHttpServer extends McpHttpBind {
  url: string
  close: () => Promise<void>
  closed: Promise<void>
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function headerValue(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

export function parseListenAddress(value: string, fallbackHost = '127.0.0.1'): McpHttpBind {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Listen address cannot be empty.')
  if (/^\d+$/.test(trimmed)) {
    return { host: fallbackHost, port: Number.parseInt(trimmed, 10) }
  }
  const ipv6 = trimmed.match(/^\[([^\]]+)\]:(\d+)$/)
  if (ipv6) return { host: ipv6[1], port: Number.parseInt(ipv6[2], 10) }
  const colon = trimmed.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    return { host: trimmed.slice(0, colon), port: Number.parseInt(trimmed.slice(colon + 1), 10) }
  }
  throw new Error(`Invalid listen address: ${value}`)
}

function parseOriginList(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, '').toLowerCase())
    .filter(Boolean)
}

export function resolveMcpHttpBind(input: {
  flags?: Record<string, string | boolean>
  env?: NodeJS.ProcessEnv
}): McpHttpBind {
  const flags = input.flags ?? {}
  const env = input.env ?? process.env
  const listen = typeof flags.listen === 'string' ? flags.listen : env.MCP_LISTEN
  const fallbackHost = typeof flags.host === 'string'
    ? flags.host
    : (env.MCP_HOST?.trim() || '127.0.0.1')
  const bind = listen
    ? parseListenAddress(listen, fallbackHost)
    : {
      host: fallbackHost,
      port: Number.parseInt(typeof flags.port === 'string' ? flags.port : (env.MCP_PORT || String(DEFAULT_MCP_PORT)), 10)
    }
  if (!Number.isInteger(bind.port) || bind.port < 1 || bind.port > 65535) {
    throw new Error(`Invalid MCP port: ${bind.port}`)
  }
  const token = (typeof flags.token === 'string' ? flags.token : env.MCP_TOKEN)?.trim()
  const allowedOrigins = parseOriginList(
    typeof flags['allowed-origins'] === 'string' ? flags['allowed-origins'] : env.MCP_ALLOWED_ORIGINS
  )
  return {
    ...bind,
    token: token || undefined,
    ...(allowedOrigins.length > 0 ? { allowedOrigins } : {})
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  })
  res.end(JSON.stringify(body))
}

function readBearer(req: IncomingMessage) {
  const authorization = headerValue(req, 'authorization') ?? ''
  const apiKey = headerValue(req, 'x-api-key')
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim()
  return apiKey?.trim() || undefined
}

function isAuthorized(req: IncomingMessage, token?: string) {
  if (!token) return true
  const given = Buffer.from(readBearer(req) ?? '')
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// Agents are not browsers and send no Origin. A browser always does, so any
// Origin that is not explicitly allowed is a web page trying to reach the
// local server (CSRF or DNS rebinding) and must not be able to run commands.
function isAllowedOrigin(req: IncomingMessage, allowedOrigins?: string[]) {
  const origin = headerValue(req, 'origin')
  if (!origin) return true
  return (allowedOrigins ?? []).includes(origin.trim().replace(/\/$/, '').toLowerCase())
}

function isJsonContentType(req: IncomingMessage) {
  const contentType = headerValue(req, 'content-type') ?? ''
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json'
}

function pathnameOf(req: IncomingMessage) {
  return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
}

async function readBody(req: IncomingMessage) {
  if (Number(headerValue(req, 'content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body too large.')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function wantsEventStream(req: IncomingMessage) {
  const accept = headerValue(req, 'accept') ?? ''
  return accept.includes('text/event-stream') && !accept.includes('application/json')
}

/**
 * Stateless Streamable HTTP transport: every POST carries complete JSON-RPC
 * messages and gets its responses in the same HTTP response. The server never
 * initiates messages, so there are no sessions and no standalone SSE stream.
 */
export async function startMcpHttpServer(options: McpOptions & McpHttpBind & {
  onListening?: (server: McpHttpServer) => void
}): Promise<McpHttpServer> {
  const server = createServer(async (req, res) => {
    try {
      const pathname = pathnameOf(req)

      if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
        writeJson(res, 200, {
          ok: true,
          name: 'workspace-manager',
          transport: 'streamable-http',
          mcp: '/mcp'
        })
        return
      }

      if (!isAllowedOrigin(req, options.allowedOrigins)) {
        writeJson(res, 403, { error: 'Origin not allowed' })
        return
      }

      if (!isAuthorized(req, options.token)) {
        writeJson(res, 401, { error: 'Unauthorized' })
        return
      }

      if (pathname !== '/mcp') {
        writeJson(res, 404, { error: 'Not found' })
        return
      }

      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' })
        return
      }

      if (!isJsonContentType(req)) {
        writeJson(res, 415, { error: 'Content-Type must be application/json' })
        return
      }

      const raw = await readBody(req)
      let parsed: JsonRpcRequest | JsonRpcRequest[]
      try {
        parsed = JSON.parse(raw) as JsonRpcRequest | JsonRpcRequest[]
      } catch {
        writeJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        return
      }

      const messages = Array.isArray(parsed) ? parsed : [parsed]
      const responses: unknown[] = []
      for (const message of messages) {
        const response = await handleMcpRequest(message, options)
        if (response) responses.push(response)
      }

      if (responses.length === 0) {
        res.writeHead(202)
        res.end()
        return
      }

      const body = Array.isArray(parsed) ? responses : responses[0]
      if (wantsEventStream(req)) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform'
        })
        res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`)
        return
      }

      writeJson(res, 200, body)
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      const status = error instanceof HttpError ? error.status : 500
      // The client may still be uploading; close instead of reading the rest.
      if (status === 413) res.once('finish', () => req.socket.destroy())
      writeJson(res, status, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
      }, status === 413 ? { Connection: 'close' } : undefined)
    }
  })

  let resolveClosed: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })

  const close = () => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
    server.closeIdleConnections()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.on('close', () => resolveClosed())

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  const connectHost = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host
  const result: McpHttpServer = {
    host: options.host,
    port,
    token: options.token,
    allowedOrigins: options.allowedOrigins,
    url: `http://${connectHost}:${port}/mcp`,
    close,
    closed
  }
  options.onListening?.(result)
  return result
}
