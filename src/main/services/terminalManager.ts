import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { platform } from 'node:os'
import { normalize } from 'node:path'
import type { AppSettings, CommandExecutionPlan, CommandRunPlan, ShellPreference, TerminalSession, ResumeTerminalsResult } from '@shared/types'
import { createDebounced } from '@shared/debounce'
import { appendTerminalBuffer } from '@shared/terminalBuffer'
import { buildShellEnv, getCommandInvocation } from '@shared/shellEnv'
import { killChildProcess, killPtyProcess, type KillablePty } from '@main/services/processTree'

type PtyProcess = KillablePty & {
  write: (data: string) => void
  resize?: (cols: number, rows: number) => void
  onData: (callback: (chunk: string) => void) => void
  onExit: (callback: (payload: { exitCode: number }) => void) => void
}

type PtyFactory = (options: {
  shell: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: NodeJS.ProcessEnv
}) => PtyProcess

interface TerminalSize {
  cols: number
  rows: number
}

const DEFAULT_TERMINAL_SIZE: TerminalSize = { cols: 120, rows: 30 }
const MAX_TERMINAL_DIMENSION = 1_000

function clampDimension(value: number) {
  return Math.min(MAX_TERMINAL_DIMENSION, Math.max(1, Math.floor(value)))
}

interface TerminalRunInput {
  projectId?: string | null
  workspaceId: string
  commandId: string
  title: string
  worktreePath: string | null
  shellLine: string
  runPlan: CommandRunPlan
}

interface ChainState {
  runToken: string
  steps: CommandExecutionPlan[]
  stepIndex: number
}

interface TerminalManagerOptions {
  initialSessions: TerminalSession[]
  getShellSettings?: () => Pick<AppSettings, 'preferredShell' | 'nodeCaCertificate'>
  preferredShell: ShellPreference
  onSessionChange: (sessions: TerminalSession[]) => void
  ptyFactory?: PtyFactory
  resolveSessionRun?: (session: TerminalSession) => Promise<CommandRunPlan | null>
}

export { buildShellEnv } from '@shared/shellEnv'

function appendBuffer(buffer: string, chunk: string) {
  return appendTerminalBuffer(buffer, chunk)
}

function sessionFromRunInput(input: TerminalRunInput): TerminalSession {
  const lastStep = input.runPlan.steps.at(-1)
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    commandId: input.commandId,
    title: input.title,
    pinned: false,
    worktreePath: input.worktreePath,
    cwd: normalize(lastStep?.cwd ?? ''),
    shellLine: input.shellLine,
    pythonEnvironment: lastStep?.pythonEnvironment ?? null,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    exitCode: null,
    buffer: '',
    restorable: true,
    workspacePaused: false
  }
}

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly ptys = new Map<string, PtyProcess>()
  private readonly sizes = new Map<string, TerminalSize>()
  /** The renderer's most recent console size, used for sessions it has not measured yet. */
  private lastSize: TerminalSize = DEFAULT_TERMINAL_SIZE
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly chainStates = new Map<string, ChainState>()
  private readonly manuallyStopped = new Set<string>()
  private readonly runTokens = new Map<string, string>()
  private readonly getShellSettings?: TerminalManagerOptions['getShellSettings']
  private readonly preferredShell: ShellPreference
  private readonly onSessionChange: TerminalManagerOptions['onSessionChange']
  private readonly ptyFactory: PtyFactory
  private readonly resolveSessionRun?: TerminalManagerOptions['resolveSessionRun']
  private readonly persistDebounced = createDebounced(() => this.persist(), 400)
  private pendingOutputChunks = new Map<string, string>()
  private outputEmitTimer: ReturnType<typeof setImmediate> | null = null

  constructor(options: TerminalManagerOptions) {
    super()
    this.preferredShell = options.preferredShell
    this.getShellSettings = options.getShellSettings
    this.onSessionChange = options.onSessionChange
    this.resolveSessionRun = options.resolveSessionRun
    this.ptyFactory = options.ptyFactory ?? ((input) => {
      const require = createRequire(import.meta.url)
      const pty = require('node-pty') as {
        spawn: (
          file: string,
          args: string[],
          options: {
            name: string
            cwd: string
            cols: number
            rows: number
            env: Record<string, string | undefined>
          }
        ) => PtyProcess
      }
      return pty.spawn(input.shell, input.args, {
        name: 'xterm-256color',
        cwd: input.cwd,
        cols: input.cols,
        rows: input.rows,
        env: input.env
      })
    })

    for (const session of options.initialSessions) {
      this.sessions.set(session.id, {
        ...session,
        pinned: session.pinned ?? false,
        workspacePaused: session.workspacePaused ?? false,
        pythonEnvironment: session.pythonEnvironment ?? null,
        status: session.status === 'running' ? 'stopped' : session.status
      })
    }
  }

  private snapshot() {
    return Array.from(this.sessions.values()).sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      return right.updatedAt - left.updatedAt
    })
  }

  private persist() {
    this.onSessionChange(this.snapshot())
  }

  private persistNow() {
    this.persistDebounced.cancel()
    this.persist()
  }

  private flushOutputEmits() {
    if (this.outputEmitTimer !== null) {
      clearImmediate(this.outputEmitTimer)
      this.outputEmitTimer = null
    }
    if (this.pendingOutputChunks.size === 0) return
    const pending = this.pendingOutputChunks
    this.pendingOutputChunks = new Map()
    for (const [sessionId, chunk] of pending) {
      this.emit('output', { sessionId, chunk })
    }
  }

  private queueOutputEmit(sessionId: string, chunk: string) {
    this.pendingOutputChunks.set(sessionId, `${this.pendingOutputChunks.get(sessionId) ?? ''}${chunk}`)
    if (this.outputEmitTimer !== null) return
    this.outputEmitTimer = setImmediate(() => {
      this.outputEmitTimer = null
      this.flushOutputEmits()
    })
  }

  list() {
    return this.snapshot()
  }

  restore() {
    return this.list()
  }

  private pushOutput(sessionId: string, chunk: string, runToken?: string) {
    if (runToken && this.runTokens.get(sessionId) !== runToken) return
    const current = this.sessions.get(sessionId)
    if (!current) return
    current.buffer = appendBuffer(current.buffer, chunk)
    current.updatedAt = Date.now()
    this.sessions.set(sessionId, current)
    this.queueOutputEmit(sessionId, chunk)
    this.persistDebounced()
  }

  private finalizeExit(sessionId: string, exitCode: number | null, runToken?: string) {
    if (runToken && this.runTokens.get(sessionId) !== runToken) return
    const current = this.sessions.get(sessionId)
    if (!current) return
    const resolvedExitCode = exitCode ?? 0
    current.exitCode = resolvedExitCode
    current.status = this.manuallyStopped.has(sessionId)
      ? 'stopped'
      : resolvedExitCode === 0
        ? 'exited'
        : 'failed'
    current.updatedAt = Date.now()
    this.sessions.set(sessionId, current)
    this.ptys.delete(sessionId)
    this.children.delete(sessionId)
    this.chainStates.delete(sessionId)
    this.manuallyStopped.delete(sessionId)
    this.runTokens.delete(sessionId)
    this.flushOutputEmits()
    this.persistNow()
    this.emit('exit', { sessionId, exitCode: resolvedExitCode })
  }

  private startPtyProcess(
    sessionId: string,
    step: CommandExecutionPlan,
    runToken: string,
    chained: boolean
  ) {
    const command = getCommandInvocation(this.getShellSettings?.().preferredShell ?? this.preferredShell, step.shellLine)
    if (!chained) {
      this.pushOutput(sessionId, `${step.shellLine}\r\n`, runToken)
      this.flushOutputEmits()
      this.persistNow()
    }

    try {
      const instance = this.ptyFactory({
        shell: command.shell,
        args: command.args,
        cwd: step.cwd,
        ...(this.sizes.get(sessionId) ?? this.lastSize),
        env: buildShellEnv(step.pythonEnvironment, { interactive: true, nodeCaCertificate: this.getShellSettings?.().nodeCaCertificate })
      })

      this.ptys.set(sessionId, instance)

      instance.onData((chunk) => {
        this.pushOutput(sessionId, chunk, runToken)
      })

      instance.onExit(({ exitCode }) => {
        this.ptys.delete(sessionId)
        if (chained) this.handleChainStepExit(sessionId, exitCode, runToken)
        else this.finalizeExit(sessionId, exitCode, runToken)
      })
    } catch (error) {
      this.pushOutput(
        sessionId,
        `[workspace-manager] PTY unavailable, using stream fallback.\r\n${String(error)}\r\n`,
        runToken
      )
      this.spawnFallbackProcess(sessionId, step, runToken, chained)
    }
  }

  private runChainStep(sessionId: string, runToken: string) {
    const chainState = this.chainStates.get(sessionId)
    if (!chainState || chainState.runToken !== runToken) return
    const step = chainState.steps[chainState.stepIndex]
    if (!step) {
      this.finalizeExit(sessionId, 0, runToken)
      return
    }

    this.pushOutput(
      sessionId,
      `\r\n[${chainState.stepIndex + 1}/${chainState.steps.length}] Running ${step.title}\r\n$ ${step.shellLine}\r\n`,
      runToken
    )
    this.startPtyProcess(sessionId, step, runToken, true)
  }

  private handleChainStepExit(sessionId: string, exitCode: number | null, runToken: string) {
    if (runToken && this.runTokens.get(sessionId) !== runToken) return

    if (this.manuallyStopped.has(sessionId)) {
      this.finalizeExit(sessionId, exitCode ?? 0, runToken)
      return
    }

    const chainState = this.chainStates.get(sessionId)
    if (!chainState || chainState.runToken !== runToken) return
    const resolvedExitCode = exitCode ?? 0
    this.children.delete(sessionId)

    if (resolvedExitCode !== 0) {
      this.finalizeExit(sessionId, resolvedExitCode, runToken)
      return
    }

    chainState.stepIndex += 1
    this.chainStates.set(sessionId, chainState)
    if (chainState.stepIndex >= chainState.steps.length) {
      this.finalizeExit(sessionId, 0, runToken)
      return
    }

    this.runChainStep(sessionId, runToken)
  }

  private spawnFallbackProcess(
    sessionId: string,
    step: CommandExecutionPlan,
    runToken: string,
    chained: boolean
  ) {
    const command = getCommandInvocation(this.getShellSettings?.().preferredShell ?? this.preferredShell, step.shellLine)
    const child = spawn(command.shell, command.args, {
      cwd: step.cwd,
      env: buildShellEnv(step.pythonEnvironment, { interactive: false, nodeCaCertificate: this.getShellSettings?.().nodeCaCertificate }),
      stdio: 'pipe',
      detached: platform() !== 'win32',
      windowsHide: true
    })

    this.children.set(sessionId, child)

    child.stdout.on('data', (chunk) => {
      this.pushOutput(sessionId, chunk.toString(), runToken)
    })
    child.stderr.on('data', (chunk) => {
      this.pushOutput(sessionId, chunk.toString(), runToken)
    })
    child.on('error', (error) => {
      this.pushOutput(sessionId, `[workspace-manager] Failed to start shell.\r\n${String(error)}\r\n`, runToken)
      if (chained) this.handleChainStepExit(sessionId, 1, runToken)
      else this.finalizeExit(sessionId, 1, runToken)
    })
    child.on('exit', (code) => {
      if (chained) this.handleChainStepExit(sessionId, code, runToken)
      else this.finalizeExit(sessionId, code, runToken)
    })
  }

  private startSession(session: TerminalSession, runPlan: CommandRunPlan) {
    const runToken = randomUUID()
    this.sessions.set(session.id, session)
    this.runTokens.set(session.id, runToken)
    this.persistNow()

    if (runPlan.kind === 'chain') {
      this.chainStates.set(session.id, {
        runToken,
        steps: runPlan.steps,
        stepIndex: 0
      })
      this.runChainStep(session.id, runToken)
      return
    }

    const step = runPlan.steps[0]
    if (!step) {
      this.finalizeExit(session.id, 1, runToken)
      return
    }

    this.startPtyProcess(session.id, step, runToken, false)
  }

  async run(input: TerminalRunInput) {
    const session = sessionFromRunInput(input)
    this.startSession(session, input.runPlan)
    return session
  }

  async write(sessionId: string, data: string) {
    const ptyProcess = this.ptys.get(sessionId)
    if (ptyProcess) {
      ptyProcess.write(data)
      return
    }

    this.children.get(sessionId)?.stdin.write(data)
  }

  /** Match the PTY to the renderer's console size. The pipe fallback has no size, so it ignores this. */
  resize(sessionId: string, cols: number, rows: number) {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    const size = { cols: clampDimension(cols), rows: clampDimension(rows) }
    this.sizes.set(sessionId, size)
    this.lastSize = size
    try {
      this.ptys.get(sessionId)?.resize?.(size.cols, size.rows)
    } catch {
      // The PTY may have exited between the renderer's measurement and this call.
    }
  }

  private killSessionProcesses(sessionId: string, options?: { sync?: boolean }) {
    const pty = this.ptys.get(sessionId)
    if (pty) {
      killPtyProcess(pty, options)
      this.ptys.delete(sessionId)
    }

    const child = this.children.get(sessionId)
    if (child) {
      killChildProcess(child, options)
      this.children.delete(sessionId)
    }
  }

  async stop(sessionId: string, options?: { workspacePaused?: boolean }) {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    this.manuallyStopped.add(sessionId)
    this.killSessionProcesses(sessionId)
    current.status = 'stopped'
    current.workspacePaused = options?.workspacePaused ?? false
    current.updatedAt = Date.now()
    this.sessions.set(sessionId, current)
    this.flushOutputEmits()
    this.persistNow()
    return current
  }

  async stopAll() {
    const updated: TerminalSession[] = []
    for (const session of this.sessions.values()) {
      if (session.status !== 'running') continue
      const next = await this.stop(session.id)
      if (next) updated.push(next)
    }
    return updated
  }

  async pauseWorkspace(workspaceId: string) {
    const updated: TerminalSession[] = []
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== workspaceId || session.status !== 'running') continue
      const next = await this.stop(session.id, { workspacePaused: true })
      if (next) updated.push(next)
    }
    return updated
  }

  async pauseGroup(workspaceIds: string[]) {
    const sessions: TerminalSession[] = []
    for (const workspaceId of new Set(workspaceIds)) {
      sessions.push(...await this.pauseWorkspace(workspaceId))
    }
    return sessions
  }

  async stopGroup(workspaceIds: string[]) {
    const ids = new Set(workspaceIds)
    const sessions: TerminalSession[] = []
    for (const session of this.snapshot()) {
      if (!ids.has(session.workspaceId) || (session.status !== 'running' && !session.workspacePaused)) continue
      const stopped = await this.stop(session.id)
      if (stopped) sessions.push(stopped)
    }
    return sessions
  }

  /** Return the removed records so callers can remove the same tabs from their view. */
  async killGroup(workspaceIds: string[]) {
    const ids = new Set(workspaceIds)
    const removed = this.snapshot().filter((session) => ids.has(session.workspaceId))
    for (const session of removed) await this.remove(session.id)
    return removed
  }

  async resumeWorkspace(workspaceId: string): Promise<ResumeTerminalsResult> {
    return this.resumeGroup([workspaceId])
  }

  async resumeGroup(workspaceIds: string[]): Promise<ResumeTerminalsResult> {
    const ids = new Set(workspaceIds)
    const pausedSessions = this.snapshot().filter((session) => ids.has(session.workspaceId) && session.workspacePaused)
    const sessions: TerminalSession[] = []
    const warnings: string[] = []
    for (const session of pausedSessions) {
      try {
        const next = await this.restart(session.id)
        if (!next) throw new Error('Console no longer exists.')
        sessions.push(next)
      } catch (error) {
        warnings.push(`${session.title}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { sessions, warnings }
  }

  async restart(sessionId: string) {
    const current = this.sessions.get(sessionId)
    if (!current) return null

    const nextRunPlan = await this.resolveSessionRun?.(current) ?? {
      kind: 'single',
      commandId: current.commandId,
      title: current.title,
      shellLine: current.shellLine,
      steps: [{
        commandId: current.commandId,
        title: current.title,
        cwd: current.cwd,
        shellLine: current.shellLine,
        pythonEnvironment: current.pythonEnvironment
      }]
    } satisfies CommandRunPlan

    this.manuallyStopped.add(sessionId)
    this.killSessionProcesses(sessionId)
    this.manuallyStopped.delete(sessionId)
    this.chainStates.delete(sessionId)

    const lastStep = nextRunPlan.steps.at(-1)
    current.status = 'running'
    current.workspacePaused = false
    current.exitCode = null
    current.buffer = ''
    current.updatedAt = Date.now()
    current.shellLine = nextRunPlan.shellLine
    current.cwd = normalize(lastStep?.cwd ?? current.cwd)
    current.pythonEnvironment = lastStep?.pythonEnvironment ?? null
    this.sessions.set(sessionId, current)
    this.startSession(current, nextRunPlan)
    return current
  }

  async clear(sessionId: string) {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    current.buffer = ''
    current.updatedAt = Date.now()
    this.sessions.set(sessionId, current)
    this.flushOutputEmits()
    this.persistNow()
    return current
  }

  async rename(sessionId: string, title: string) {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    const nextTitle = title.trim()
    if (!nextTitle) return current
    current.title = nextTitle
    current.updatedAt = Date.now()
    this.sessions.set(sessionId, current)
    this.persistNow()
    return current
  }

  async togglePin(sessionId: string) {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    current.pinned = !current.pinned
    current.updatedAt = Date.now()
    this.sessions.set(sessionId, current)
    this.persistNow()
    return current
  }

  async remove(sessionId: string) {
    this.killSessionProcesses(sessionId)
    this.chainStates.delete(sessionId)
    this.manuallyStopped.delete(sessionId)
    this.runTokens.delete(sessionId)
    this.sessions.delete(sessionId)
    this.sizes.delete(sessionId)
    this.flushOutputEmits()
    this.persistNow()
  }

  shutdown() {
    const runningSessionIds = new Set([...this.ptys.keys(), ...this.children.keys()])
    for (const sessionId of runningSessionIds) {
      this.manuallyStopped.add(sessionId)
      this.killSessionProcesses(sessionId, { sync: true })
    }
    this.ptys.clear()
    this.children.clear()
    this.chainStates.clear()
    this.manuallyStopped.clear()
    this.runTokens.clear()

    for (const session of this.sessions.values()) {
      if (session.status !== 'running') continue
      session.status = 'stopped'
      session.updatedAt = Date.now()
    }
    this.flushOutputEmits()
    this.persistNow()
  }
}
