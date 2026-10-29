import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeRunPlan } from '@agent/runCommand'
import type { CommandRunPlan } from '@shared/types'

function plan(cwd: string, shellLine: string): CommandRunPlan {
  return {
    kind: 'single',
    commandId: 'p1::root::probe',
    title: 'probe',
    shellLine,
    steps: [{
      commandId: 'p1::root::probe',
      title: 'probe',
      cwd,
      shellLine,
      pythonEnvironment: null
    }]
  }
}

describe('agent command execution', () => {
  it('captures stdout from a successful command', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'workspace-manager-run-'))
    try {
      const result = await executeRunPlan(plan(cwd, 'node -e "process.stdout.write(\'ok-from-agent\')"'), {
        preferredShell: 'bash'
      })
      expect(result.exitCode).toBe(0)
      expect(result.steps[0]?.output).toContain('ok-from-agent')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('injects the configured Node CA certificate into headless commands', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'workspace-manager-ca-'))
    try {
      const certificate = join(cwd, 'CA.pem')
      const result = await executeRunPlan(plan(cwd, 'node -e "process.stdout.write(process.env.NODE_EXTRA_CA_CERTS || \'missing\')"'), {
        preferredShell: 'bash', nodeCaCertificate: certificate
      })
      expect(result.exitCode).toBe(0)
      expect(result.steps[0]?.output).toContain(certificate)
    } finally { await rm(cwd, { recursive: true, force: true }) }
  })

  it('returns a timed-out result instead of hanging', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'workspace-manager-timeout-'))
    try {
      const result = await executeRunPlan(
        plan(cwd, 'node -e "setTimeout(() => {}, 5000)"'),
        { preferredShell: 'bash', timeoutMs: 200 }
      )
      expect(result.timedOut).toBe(true)
      expect(result.exitCode).toBe(124)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('dry-run returns the plan without executing', async () => {
    const result = await executeRunPlan(plan('/tmp', 'node -e "throw new Error(\'nope\')"'), {
      preferredShell: 'bash',
      dryRun: true
    })
    expect(result.exitCode).toBe(0)
    expect(result.steps[0]?.output).toBe('')
  })

  it('reports a shell killed by a signal as a failure', async () => {
    const result = await executeRunPlan(plan('/tmp', 'kill -KILL $$'), { preferredShell: 'bash', timeoutMs: 5000 })
    expect(result.exitCode).toBe(137)
  })

  it('captures output written right before the shell exits', async () => {
    const result = await executeRunPlan(plan('/tmp', 'seq 1 20000'), { preferredShell: 'bash', timeoutMs: 10000 })
    expect(result.exitCode).toBe(0)
    const output = result.steps[0]?.output ?? ''
    expect(output.startsWith('… truncated ')).toBe(true)
    expect(output.trimEnd().endsWith('\n20000')).toBe(true)
  })

  it('does not wait for background processes that keep the output pipe open', async () => {
    const started = Date.now()
    const result = await executeRunPlan(plan('/tmp', 'echo started; (sleep 3 &)'), { preferredShell: 'bash', timeoutMs: 10000 })
    expect(result.exitCode).toBe(0)
    expect(result.steps[0]?.output).toContain('started')
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
