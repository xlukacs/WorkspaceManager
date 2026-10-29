import { spawn } from 'node:child_process'
import { constants, platform } from 'node:os'
import type { CommandExecutionPlan, CommandRunPlan, ShellPreference } from '@shared/types'
import { buildShellEnv, getCommandInvocation, toChildProcessArgs } from '@shared/shellEnv'
import { isLongRunningRunPlan } from '@shared/terminalExecution'

export const DEFAULT_RUN_TIMEOUT_MS = 120_000
export const MAX_CAPTURED_OUTPUT_CHARS = 80_000
// How long to keep reading output after the shell exits. Background processes
// it started can hold the pipes open indefinitely, so this is only a grace period.
const OUTPUT_DRAIN_MS = 250

export interface RunStepResult {
  title: string
  cwd: string
  shellLine: string
  exitCode: number
  output: string
  timedOut: boolean
}

export interface RunCommandResult {
  commandId: string
  title: string
  longRunning: boolean
  timedOut: boolean
  exitCode: number
  steps: RunStepResult[]
}

export interface ExecuteRunPlanOptions {
  nodeCaCertificate?: string | null
  preferredShell: ShellPreference
  timeoutMs?: number
  dryRun?: boolean
  onChunk?: (chunk: string) => void
}

function trimOutput(output: string) {
  if (output.length <= MAX_CAPTURED_OUTPUT_CHARS) return output
  const omitted = output.length - MAX_CAPTURED_OUTPUT_CHARS
  return `… truncated ${omitted} earlier characters …\n${output.slice(-MAX_CAPTURED_OUTPUT_CHARS)}`
}

function exitCodeOf(code: number | null, signal: NodeJS.Signals | null) {
  if (code !== null) return code
  // Match shells: a process killed by signal N exits with 128 + N.
  return signal ? 128 + (constants.signals[signal] ?? 0) : 1
}

function killProcess(pid: number | undefined) {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      process.kill(pid, 'SIGTERM')
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Process may already have exited.
        }
      }
    }, 150)
  } catch {
    // Process may already have exited.
  }
}

function runStep(
  step: CommandExecutionPlan,
  preferredShell: ShellPreference,
  timeoutMs: number,
  onChunk?: (chunk: string) => void,
  nodeCaCertificate?: string | null
): Promise<RunStepResult> {
  return new Promise((resolve) => {
    const invocation = getCommandInvocation(preferredShell, step.shellLine)
    const { args, windowsVerbatimArguments } = toChildProcessArgs(invocation)
    const child = spawn(invocation.shell, args, {
      cwd: step.cwd,
      env: buildShellEnv(step.pythonEnvironment, { interactive: false, nodeCaCertificate }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: platform() !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments
    })

    let output = ''
    let timedOut = false
    let settled = false
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        killProcess(child.pid)
      }, timeoutMs)
      : null

    const append = (chunk: Buffer | string) => {
      const text = chunk.toString()
      output += text
      onChunk?.(text)
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      append(`[workspace-manager] Failed to start shell.\n${String(error)}\n`)
      finish(1)
    })
    child.on('close', (code, signal) => finish(exitCodeOf(code, signal)))
    child.on('exit', (code, signal) => {
      setTimeout(() => finish(exitCodeOf(code, signal)), OUTPUT_DRAIN_MS).unref()
    })

    function finish(exitCode: number) {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child.stdout.destroy()
      child.stderr.destroy()
      resolve({
        title: step.title,
        cwd: step.cwd,
        shellLine: step.shellLine,
        exitCode,
        output: trimOutput(output),
        timedOut
      })
    }
  })
}

export async function executeRunPlan(
  plan: CommandRunPlan,
  options: ExecuteRunPlanOptions
): Promise<RunCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
  const longRunning = isLongRunningRunPlan(plan)

  if (options.dryRun) {
    return {
      commandId: plan.commandId,
      title: plan.title,
      longRunning,
      timedOut: false,
      exitCode: 0,
      steps: plan.steps.map((step) => ({
        title: step.title,
        cwd: step.cwd,
        shellLine: step.shellLine,
        exitCode: 0,
        output: '',
        timedOut: false
      }))
    }
  }

  const steps: RunStepResult[] = []
  const startedAt = Date.now()

  for (const [index, step] of plan.steps.entries()) {
    const remaining = timeoutMs > 0 ? Math.max(1, timeoutMs - (Date.now() - startedAt)) : 0
    options.onChunk?.(
      plan.kind === 'chain'
        ? `\n[${index + 1}/${plan.steps.length}] ${step.title}\n$ ${step.shellLine}\n`
        : `$ ${step.shellLine}\n`
    )
    const result = await runStep(step, options.preferredShell, remaining, options.onChunk, options.nodeCaCertificate)
    steps.push(result)
    if (result.exitCode !== 0 || result.timedOut) {
      return {
        commandId: plan.commandId,
        title: plan.title,
        longRunning,
        timedOut: result.timedOut,
        exitCode: result.timedOut ? 124 : result.exitCode,
        steps
      }
    }
  }

  return {
    commandId: plan.commandId,
    title: plan.title,
    longRunning,
    timedOut: false,
    exitCode: 0,
    steps
  }
}
