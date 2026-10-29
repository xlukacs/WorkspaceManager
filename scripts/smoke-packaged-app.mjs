// Runs against installed packages, including the real Electron/native PTY runtime.
// Requires Node 22+ and a display (use xvfb-run on a Linux CI runner).
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [executableArg, cliArg] = process.argv.slice(2)
assert(executableArg, 'Usage: node scripts/smoke-packaged-app.mjs <desktop-executable> [cli-executable]')
const executable = resolve(executableArg)
const root = mkdtempSync(join(tmpdir(), 'wsm package smoke '))
const userData = join(root, 'user data')
const workspace = join(root, 'test workspace')
const endpointPath = join(userData, 'cli.json')
const storePath = join(userData, 'workspace-manager.json')
mkdirSync(workspace, { recursive: true })
writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'package-smoke', private: true }))
writeFileSync(join(workspace, 'probe.cjs'), `
console.log('WSM_PTY_READY:' + JSON.stringify({ tty: !!process.stdout.isTTY, cwd: process.cwd() }))
setInterval(() => {}, 1000)
`)

const env = { ...process.env, WORKSPACE_MANAGER_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(executable, ['--no-sandbox', '--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
let spawnError
app.stdout.on('data', (chunk) => { logs += chunk })
app.stderr.on('data', (chunk) => { logs += chunk })
app.on('error', (error) => { spawnError = error })
const exited = new Promise((done) => app.once('exit', done))
let debuggerSocket

async function until(description, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (await predicate()) return
    await delay(200)
  }
  throw new Error(`Timed out: ${description}`)
}

function cli(args, selectedStore = storePath) {
  // Windows wrappers are checked separately by the installer smoke test. Use the
  // same installed Electron/ASAR entry here without cmd.exe argument re-parsing.
  const result = process.platform === 'win32'
    ? spawnSync(executable, [join(dirname(executable), 'resources', 'app.asar', 'out', 'cli', 'index.js'), '--store', selectedStore, ...args],
      { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 20_000 })
    : spawnSync(cliArg?.endsWith('.js') ? process.execPath : cliArg ?? '/usr/bin/wsm',
      [...(cliArg?.endsWith('.js') ? [resolve(cliArg)] : []), '--store', selectedStore, ...args], { env, encoding: 'utf8', timeout: 20_000 })
  assert.ifError(result.error)
  return result
}

function jsonCli(args) {
  const result = cli([...args, '--json'])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function appRequest(request) {
  const endpoint = JSON.parse(readFileSync(endpointPath, 'utf8'))
  return new Promise((done, fail) => {
    const socket = connect(endpoint.port, '127.0.0.1', () => {
      socket.write(JSON.stringify({ token: endpoint.token, storePath, request }) + '\n')
    })
    let data = ''
    socket.setTimeout(10_000, () => socket.destroy(new Error('App request timed out')))
    socket.on('error', fail)
    socket.on('data', (chunk) => { data += chunk })
    socket.on('end', () => {
      try {
        const response = JSON.parse(data)
        assert(response.ok, response.error)
        done(response.result)
      } catch (error) { fail(error) }
    })
  })
}

// Check that the packaged renderer loaded and close the real window cleanly.
// The debugging port is random, bound to loopback and enabled only by this test.
async function openDebugger() {
  const port = readFileSync(join(userData, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  assert(page, 'Packaged desktop has no renderer')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }) })
  let sequence = 0
  const requests = new Map()
  socket.addEventListener('message', (event) => {
    const response = JSON.parse(event.data)
    const pending = requests.get(response.id)
    if (!pending) return
    requests.delete(response.id)
    clearTimeout(pending.timer)
    if (response.error) pending.fail(new Error(JSON.stringify(response.error)))
    else pending.done(response.result)
  })
  return {
    close: () => socket.close(),
    evaluate: (expression) => new Promise((done, fail) => {
      const id = ++sequence
      const timer = setTimeout(() => { requests.delete(id); fail(new Error('Renderer evaluation timed out')) }, 10_000)
      requests.set(id, { done, fail, timer })
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
  }
}

try {
  await until('app CLI endpoint', () => existsSync(endpointPath) && existsSync(join(userData, 'DevToolsActivePort')))
  debuggerSocket = await openDebugger()
  await until('rendered desktop', async () => (await debuggerSocket.evaluate("!!document.querySelector('.shell')")).result?.value === true)
  const added = jsonCli(['add', workspace])
  assert.equal(added.rootPath.toLowerCase(), workspace.toLowerCase())
  const started = cli(['start', '--cwd', workspace, '--label', 'package smoke', '--', process.execPath, join(workspace, 'probe.cjs')])
  assert.equal(started.status, 0, started.stderr)
  const sessionId = started.stdout.trim()
  async function verifyPty() {
    await until('native PTY output', async () => {
      const { output } = await appRequest({ action: 'output', sessionId })
      assert(!output.includes('PTY unavailable'), output)
      return output.includes('WSM_PTY_READY:') && output.includes('"tty":true')
    })
    assert.equal(jsonCli(['sessions', '--running']).find((session) => session.id === sessionId)?.status, 'running')
  }
  await verifyPty()
  jsonCli(['pause', '--workspace', added.id])
  assert.equal(jsonCli(['sessions']).find((session) => session.id === sessionId)?.workspacePaused, true)
  jsonCli(['resume', '--workspace', added.id])
  await verifyPty()
  jsonCli(['focus', '--session', sessionId])
  jsonCli(['stop', sessionId])
  assert.equal(jsonCli(['sessions']).find((session) => session.id === sessionId)?.status, 'stopped')
  const wrongStore = cli(['sessions'], join(userData, 'different.json'))
  assert.notEqual(wrongStore.status, 0, 'A different store in the same directory controlled the app')
  assert.match(wrongStore.stderr, /different store/i)
  await debuggerSocket.evaluate('setTimeout(() => window.close(), 100)')
  await until('desktop exit after closing its window', () => app.exitCode !== null, 15_000)
  assert(!existsSync(endpointPath), 'App left its endpoint behind on exit')
  console.log('Packaged desktop, renderer, native PTY, CLI controls and store routing passed.')
} catch (error) {
  console.error(logs)
  throw error
} finally {
  debuggerSocket?.close()
  if (app.exitCode === null) {
    app.kill()
    await Promise.race([exited, delay(5000)])
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
