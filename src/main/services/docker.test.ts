import { describe, expect, it } from 'vitest'
import { listDockerCommands, resolveDockerCommandExecution, resolveDockerRunPlan, validateDockerCommandChain } from '@main/services/docker'
import type { LegacyWorkspaceRecord } from '@shared/types'

const composeWorkspace: LegacyWorkspaceRecord = {
  id: 'p1',
  name: 'demo',
  nameOverride: null,
  order: 0,
  rootPath: '/tmp/demo',
  groupIds: ['active'],
  packageManager: 'pnpm',
  isMonorepo: false,
  rootScripts: {},
  workspacePackages: [],
  docker: {
    composeFile: 'compose.yaml',
    dockerfile: 'Dockerfile',
    services: ['api', 'web']
  },
  pythonEnvironment: null,
  commandChains: {},
  favoriteCommandIds: [],
  lastScanAt: Date.now(),
  quickLinks: [],
  gitSummary: null,
  gitWorktrees: [],
  gitWorktreesRoot: null
}

describe('docker commands', () => {
  it('builds compose and service command groups', () => {
    const result = listDockerCommands(composeWorkspace)
    expect(result.groups.map((group) => group.key)).toEqual(['compose', 'services', 'dockerfile'])
    expect(result.groups[0]?.commands[0]?.title).toBe('Compose Up')
    expect(result.groups[1]?.commands.some((command) => command.title === 'web Logs')).toBe(true)
  })

  it('resolves docker command execution', () => {
    const plan = resolveDockerCommandExecution(composeWorkspace, 'p1::docker::compose-up')
    expect(plan?.cwd).toBe('/tmp/demo')
    expect(plan?.shellLine).toBe('docker compose -f compose.yaml up')
  })

  it('quotes compose files only when the path needs it', () => {
    const spaced = resolveDockerCommandExecution(
      { ...composeWorkspace, docker: { ...composeWorkspace.docker!, composeFile: 'my compose.yaml' } },
      'p1::docker::compose-up'
    )
    expect(spaced?.shellLine).toBe('docker compose -f "my compose.yaml" up')
  })

  it('exposes docker prerequisite metadata and resolves chained runs', () => {
    const chainedWorkspace: LegacyWorkspaceRecord = {
      ...composeWorkspace,
      commandChains: {
        'p1::docker::compose-up': ['p1::docker::compose-build']
      }
    }

    const list = listDockerCommands(chainedWorkspace)
    const composeUp = list.groups[0]?.commands.find((command) => command.id === 'p1::docker::compose-up')
    expect(composeUp?.hasChain).toBe(true)
    expect(composeUp?.prerequisiteTitles).toEqual(['Compose Build'])

    const runPlan = resolveDockerRunPlan(chainedWorkspace, 'p1::docker::compose-up')
    expect(runPlan?.kind).toBe('chain')
    expect(runPlan?.steps.map((step) => step.commandId)).toEqual([
      'p1::docker::compose-build',
      'p1::docker::compose-up'
    ])
  })

  it('rejects invalid docker prerequisite chains', () => {
    expect(() => validateDockerCommandChain(composeWorkspace, 'p1::docker::compose-up', ['missing::docker'])).toThrow(
      'Unknown prerequisite docker command: missing::docker'
    )
    expect(() => validateDockerCommandChain(composeWorkspace, 'p1::docker::compose-up', ['p1::docker::compose-up'])).toThrow(
      'A command cannot depend on itself.'
    )
  })
})
