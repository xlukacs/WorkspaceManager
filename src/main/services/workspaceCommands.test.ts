import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { catalogFromState } from '@agent/catalog'
import { runCli } from '@agent/cli'
import { handleMcpRequest } from '@agent/mcp'
import legacy from '@shared/fixtures/store-v11.json'
import { decodeWorkspaceState } from '@shared/workspaceModel'
import type { PersistedState } from '@shared/persistedState'
import { scanWorkspace } from './workspaceScan'
import { listWorkspaceCommands, resolveRunPlan, validateWorkspaceCommandChain } from './workspaceCommands'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wsm-planner-'))
  roots.push(root)
  const feature = join(root, '.worktrees', 'feature')
  for (const directory of ['apps/web', 'services/api/.venv/bin', 'infrastructure']) {
    await mkdir(join(root, directory), { recursive: true })
    await mkdir(join(feature, directory.replace('/.venv/bin', '')), { recursive: true })
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'product', packageManager: 'pnpm@10.0.0', workspaces: ['apps/*'], scripts: { build: 'tsc' } }))
  await writeFile(join(root, 'apps/web/package.json'), JSON.stringify({ name: 'web', scripts: { dev: 'vite' } }))
  await writeFile(join(root, 'services/api/requirements.txt'), 'requests\n')
  await writeFile(join(root, 'services/api/.venv/bin/python'), '')
  await mkdir(join(root, 'services/api/.venv/Scripts'), { recursive: true })
  await writeFile(join(root, 'services/api/.venv/Scripts/python.exe'), '')
  await writeFile(join(root, 'infrastructure/compose.yaml'), 'services:\n  db:\n    image: postgres\n')
  const workspace = await scanWorkspace(root, 'active')
  workspace.gitWorktrees = [
    { path: root, branch: 'main', head: null, isMain: true, isBare: false, isLocked: false },
    { path: feature, branch: 'feature', head: null, isMain: false, isBare: false, isLocked: false }
  ]
  workspace.runActions = [{ id: 'prepare', description: 'Prepare', command: 'node prepare.js' }]
  const web = workspace.projects.find((project) => project.relativePath === 'apps/web')!
  const api = workspace.projects.find((project) => project.relativePath === 'services/api')!
  const infra = workspace.projects.find((project) => project.relativePath === 'infrastructure')!
  const ids = {
    dev: `${workspace.id}::${web.id}::dev`, python: `${workspace.id}::${api.id}::synthetic::python-install`,
    docker: `${workspace.id}::${infra.id}::docker::compose-up`, action: `${workspace.id}::run-action::prepare`
  }
  return { root, feature, workspace, ids }
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('shared workspace command index and planner', () => {
  it.each(['npm', 'pnpm', 'yarn'] as const)('plans a nested Node installer with %s in the selected checkout and chains it before dev', async (packageManager) => {
    const { workspace, feature, ids } = await fixture()
    const web = workspace.projects.find((project) => project.relativePath === 'apps/web')!
    web.packageManager = packageManager
    const installId = `${workspace.id}::${web.id}::synthetic::node-install`
    const commands = listWorkspaceCommands(workspace, feature).groups.flatMap((group) => group.commands)
    expect(commands).toContainEqual(expect.objectContaining({ id: installId, synthetic: 'node-install', cwd: join(feature, 'apps/web') }))
    expect(commands).toContainEqual(expect.objectContaining({ id: `${workspace.id}::synthetic::node-install` }))
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length)
    workspace.commandChains = { [ids.dev]: [installId] }
    const plan = resolveRunPlan(workspace, ids.dev, feature)!
    expect(plan.steps.map((step) => step.commandId)).toEqual([installId, ids.dev])
    expect(plan.steps[0]).toMatchObject({ shellLine: `${packageManager} install`, cwd: join(feature, 'apps/web') })
  })

  it('preserves an explicit nested install script without colliding with a synthetic installer', async () => {
    const { workspace } = await fixture()
    const web = workspace.projects.find((project) => project.relativePath === 'apps/web')!
    web.scripts.install = 'node setup.js'
    const commands = listWorkspaceCommands(workspace).groups.flatMap((group) => group.commands)
    const installId = `${workspace.id}::${web.id}::install`
    expect(commands.filter((command) => command.projectId === web.id && command.name === 'install')).toEqual([
      expect.objectContaining({ id: installId, synthetic: undefined })
    ])
    expect(resolveRunPlan(workspace, installId)?.steps[0]?.shellLine).toBe('pnpm run install')
  })

  it('indexes all command kinds by project, retaining root and package command IDs', async () => {
    const { workspace, ids, feature } = await fixture()
    const list = listWorkspaceCommands(workspace, feature)
    const all = list.groups.flatMap((group) => group.commands)
    for (const id of Object.values(ids)) expect(all.some((command) => command.id === id)).toBe(true)
    expect(all.some((command) => command.id === `${workspace.id}::root::build`)).toBe(true)
    expect(all.some((command) => command.id === `${workspace.id}::synthetic::node-install`)).toBe(true)
    expect(all.find((command) => command.id === ids.action)?.cwd).toBe(feature)
    expect(all.find((command) => command.id === ids.dev)?.cwd).toBe(join(feature, 'apps/web'))
    expect(list.groups.find((group) => group.relativePath === 'infrastructure')?.commands.some((command) => command.kind === 'docker')).toBe(true)
  })

  it('fully expands a Python → Docker → Node chain inside the selected worktree', async () => {
    const { workspace, ids, feature, root } = await fixture()
    workspace.projects.find((project) => project.relativePath === 'infrastructure')!.docker!.composeFile = join(root, 'infrastructure/compose.yaml')
    workspace.commandChains = { [ids.dev]: [ids.docker], [ids.docker]: [ids.python] }
    const plan = resolveRunPlan(workspace, ids.dev, feature)!
    expect(plan.steps.map((step) => step.commandId)).toEqual([`${ids.python}::create-env`, ids.python, ids.docker, ids.dev])
    expect(plan.steps.map((step) => step.cwd)).toEqual([
      join(feature, 'services/api'), join(feature, 'services/api'), join(feature, 'infrastructure'), join(feature, 'apps/web')
    ])
    expect(plan.steps[0]?.shellLine).toMatch(/^(python3|py -3) -m venv \.venv$/)
    expect(plan.steps[1]?.shellLine).toContain('-m pip install -r requirements.txt')
    expect(plan.steps[1]?.pythonEnvironment?.rootPath).toBe(join(feature, 'services/api/.venv'))
    expect(plan.steps[1]?.pythonEnvironment?.rootPath).not.toBe(join(root, 'services/api/.venv'))
    expect(plan.steps[2]?.shellLine).toBe('docker compose -f compose.yaml up')
    expect(plan.steps[3]?.shellLine).toBe('pnpm run dev')
  })

  it('deduplicates compound prerequisites across kinds and rejects mixed cycles', async () => {
    const { workspace, ids } = await fixture()
    workspace.commandChains = { [ids.dev]: [ids.docker, ids.action], [ids.docker]: [ids.python], [ids.action]: [ids.python] }
    const plan = resolveRunPlan(workspace, ids.dev)!
    expect(plan.steps.filter((step) => step.commandId === ids.python)).toHaveLength(1)
    expect(plan.steps.map((step) => step.commandId)).toEqual([ids.python, ids.docker, ids.action, ids.dev])
    expect(validateWorkspaceCommandChain(workspace, ids.dev, [ids.docker, ids.action, ids.docker])).toEqual([ids.docker, ids.action])
    workspace.commandChains[ids.python] = [ids.dev]
    expect(() => resolveRunPlan(workspace, ids.dev)).toThrow('cycle detected')
    expect(() => validateWorkspaceCommandChain(workspace, ids.dev, ['unknown'])).toThrow('Unknown prerequisite command: unknown')
  })

  it('rejects unknown/missing worktrees and a project folder absent from a valid checkout', async () => {
    const { workspace, ids, feature } = await fixture()
    await rm(join(feature, 'apps/web'), { recursive: true })
    expect(() => resolveRunPlan(workspace, ids.dev, feature)).toThrow('Project folder "apps/web" is missing')
    expect(() => resolveRunPlan(workspace, ids.dev, '/unknown-worktree')).toThrow('Unknown worktree')
    workspace.gitWorktrees[1]!.isMissing = true
    expect(() => resolveRunPlan(workspace, ids.dev, feature)).toThrow('missing on disk')
  })

  it('uses the same mixed-chain plans through CLI and MCP against a v12 store', async () => {
    const { workspace, ids, feature, root } = await fixture()
    workspace.commandChains = { [ids.dev]: [ids.docker], [ids.docker]: [ids.python] }
    const state = { ...decodeWorkspaceState(legacy as PersistedState), workspaces: [workspace] }
    const storePath = join(root, 'workspace-manager.json')
    await writeFile(storePath, JSON.stringify(state))
    let output = ''
    let errors = ''
    expect(await runCli(['run', ids.dev, '--worktree', 'feature', '--store', storePath, '--dry-run', '--json'], {
      stdout: (text) => { output += text }, stderr: (text) => { errors += text }
    })).toBe(0)
    expect(errors).toBe('')
    const cli = JSON.parse(output)
    const mcp = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'run_command', arguments: { command: ids.dev, worktree: 'feature', dryRun: true }
    } }, { catalogLoader: () => catalogFromState(state) }) as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(mcp.result.content[0]!.text).steps).toEqual(cli.steps)
    const expected = resolveRunPlan(workspace, ids.dev, feature)!.steps
    expect(cli.steps.map((step: { cwd: string; shellLine: string }) => ({ cwd: step.cwd, shellLine: step.shellLine })))
      .toEqual(expected.map((step) => ({ cwd: step.cwd, shellLine: step.shellLine })))
  })
})
