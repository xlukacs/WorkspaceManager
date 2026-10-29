import { describe, expect, it } from 'vitest'
import type { CommandRunPlan } from '@shared/types'
import { isLongRunningRunPlan } from '@shared/terminalExecution'

function plan(shellLine: string): CommandRunPlan {
  return {
    kind: 'single',
    commandId: 'cmd',
    title: 'Task',
    shellLine,
    steps: [{
      commandId: 'cmd',
      title: 'Task',
      cwd: '/tmp',
      shellLine,
      pythonEnvironment: null
    }]
  }
}

describe('isLongRunningRunPlan', () => {
  it('treats dev servers as long running', () => {
    expect(isLongRunningRunPlan(plan('pnpm run dev'))).toBe(true)
    expect(isLongRunningRunPlan(plan('vite --watch'))).toBe(true)
    expect(isLongRunningRunPlan(plan('docker compose up'))).toBe(true)
  })

  it('treats finite tasks as short running', () => {
    expect(isLongRunningRunPlan(plan('pnpm run build'))).toBe(false)
    expect(isLongRunningRunPlan(plan('pnpm run build:win'))).toBe(false)
    expect(isLongRunningRunPlan(plan('pnpm test'))).toBe(false)
  })

  it('does not treat sudo or finite builds as long-running servers', () => {
    expect(isLongRunningRunPlan(plan('sudo dpkg -i "release/Workspace Manager.deb"'))).toBe(false)
    expect(isLongRunningRunPlan(plan('pnpm run build'))).toBe(false)
    expect(isLongRunningRunPlan(plan('cd scanner && go run ./cmd/customer-scanner'))).toBe(false)
  })
})
