import { describe, expect, it } from 'vitest'
import type { LegacyWorkspaceRecord } from '@shared/types'
import { resolveRunActionPlan, runActionCommandId } from '@shared/runActions'

const workspace = {
  id: 'demo',
  rootPath: '/repos/demo',
  pythonEnvironment: null,
  runActions: [{ id: 'dev-server', description: 'Start server', command: 'pnpm dev --host' }],
  gitWorktrees: [
    {
      path: '/repos/demo',
      branch: 'main',
      head: 'abc',
      isMain: true,
      isBare: false,
      isLocked: false
    },
    {
      path: '/repos/demo/.worktrees/feature',
      branch: 'feature',
      head: 'def',
      isMain: false,
      isBare: false,
      isLocked: false
    }
  ]
} as LegacyWorkspaceRecord

describe('runActions', () => {
  it('builds a direct shell execution plan for a custom action', () => {
    const plan = resolveRunActionPlan(workspace, 'dev-server')

    expect(plan).toMatchObject({
      commandId: runActionCommandId('demo', 'dev-server'),
      title: 'Start server',
      shellLine: 'pnpm dev --host',
      steps: [{ cwd: '/repos/demo', shellLine: 'pnpm dev --host' }]
    })
  })

  it('runs inside the selected worktree and resolves persisted terminal command ids', () => {
    const commandId = runActionCommandId('demo', 'dev-server')
    const plan = resolveRunActionPlan(workspace, commandId, '/repos/demo/.worktrees/feature')

    expect(plan?.steps[0]?.cwd).toBe('/repos/demo/.worktrees/feature')
  })

  it('points the Python environment at the selected worktree', () => {
    const withVenv = {
      ...workspace,
      pythonEnvironment: {
        id: '/repos/demo::.venv',
        name: '.venv',
        kind: 'venv',
        rootPath: '/repos/demo/.venv',
        scriptsPath: '/repos/demo/.venv/bin',
        pythonPath: '/repos/demo/.venv/bin/python'
      }
    } as LegacyWorkspaceRecord

    const inWorktree = resolveRunActionPlan(withVenv, 'dev-server', '/repos/demo/.worktrees/feature')
    expect(inWorktree?.steps[0]?.pythonEnvironment).toMatchObject({
      rootPath: '/repos/demo/.worktrees/feature/.venv',
      scriptsPath: '/repos/demo/.worktrees/feature/.venv/bin',
      pythonPath: '/repos/demo/.worktrees/feature/.venv/bin/python'
    })

    const inMain = resolveRunActionPlan(withVenv, 'dev-server')
    expect(inMain?.steps[0]?.pythonEnvironment).toEqual(withVenv.pythonEnvironment)
  })

  it('rejects unknown actions', () => {
    expect(resolveRunActionPlan(workspace, 'missing')).toBeNull()
  })
})
