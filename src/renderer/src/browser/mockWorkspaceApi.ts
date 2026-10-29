import { normalizeSettings } from '@shared/settings'
import { defaultUiState, normalizeUiState } from '@shared/navigation'
import { workspaceFromDisk, workspaceToDisk, terminalFromDisk, terminalToDisk, type PersistedState } from '@shared/persistedState'
import type {
  AppSettings,
  OpenTarget,
  AddWorkspacesInput,
  GroupCreateInput,
  GroupRecord,
  GroupUpdateInput,
  CommandDescriptor,
  CommandGroup,
  CommandListResponse,
  CommandRunPlan,
  DockerCommandDescriptor,
  DockerCommandListResponse,
  EditorTarget,
  GitSummary,
  GitWorktree,
  LinkUpsertInput,
  WorkspaceCandidate,
  LegacyWorkspaceRecord,
  MoveWorkspaceInput,
  QuickLink,
  RunCommandInput,
  SetCommandChainInput,
  SetPinnedEndpointsInput,
  SetRunConfigurationInput,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalRenameInput,
  TerminalSession,
  ToggleFavoriteInput,
  WorkspaceApi,
  UiState,
  WorkspaceRecord,
  LegacyWorkspacePackage
} from '@shared/types'
import { normalizeLegacyWorkspaceRecord } from '@shared/types'
import { normalizeWorkspaceRecord, workspaceFromLegacy } from '@shared/workspaceModel'
import { moveWorkspaceToGroup, nextOrderInGroup, normalizeGroupColor, reorderGroups, sortByOrder, ungroupWorkspaces } from '@shared/workspaceGroups'
import { classifyWorktreeForCleanup, worktreeRemoveBlockReason } from '@shared/worktreeCleanup'
import { normalizeComparePath, remapRunPlanToWorktree, resolveWorktreePath } from '@shared/worktreeExecution'
import { resolveRunActionPlan } from '@shared/runActions'
import { containsDomRendererLeak } from '@shared/terminalBuffer'
import { isLongRunningRunPlan } from '@shared/terminalExecution'

const SYNTHETIC_COMMAND_SCOPE = 'synthetic'
const NODE_INSTALL_COMMAND_ID = `${SYNTHETIC_COMMAND_SCOPE}::node-install`
const PYTHON_INSTALL_COMMAND_ID = `${SYNTHETIC_COMMAND_SCOPE}::python-install`

// The preview keeps v11-shaped workspaces internally (one group at most) and returns v12 records.
interface BrowserPreviewState {
  settings: AppSettings
  openTargets: Record<string, OpenTarget | null>
  ui: UiState
  groups: GroupRecord[]
  workspaces: LegacyWorkspaceRecord[]
  terminals: TerminalSession[]
}

const STORAGE_KEY = 'workspace-manager:web-preview'
const outputListeners = new Set<(event: TerminalOutputEvent) => void>()
const exitListeners = new Set<(event: TerminalExitEvent) => void>()
const exitTimers = new Map<string, number>()

function secondsAgo(seconds: number) {
  return Math.floor(Date.now() / 1000) - seconds
}

function mockWorktree(input: Partial<GitWorktree> & Pick<GitWorktree, 'path'>): GitWorktree {
  const lastActivityAt = input.lastActivityAt ?? secondsAgo(60 * 60 * 2)
  return {
    branch: null,
    head: 'preview',
    isMain: false,
    isBare: false,
    isLocked: false,
    isDirty: false,
    isMissing: false,
    lastActivityRelative: '2h ago',
    ...input,
    lastActivityAt
  }
}

function createGitSummary(subject: string, branch = 'main', dirty = false): GitSummary {
  return {
    branch,
    isDirty: dirty,
    stagedCount: dirty ? 2 : 0,
    unstagedCount: dirty ? 4 : 0,
    untrackedCount: dirty ? 1 : 0,
    lastCommitSubject: subject,
    lastCommitRelative: dirty ? '12 minutes ago' : '2 hours ago',
    lastCommitTimestamp: Date.now() - (dirty ? 12 * 60_000 : 2 * 60 * 60_000)
  }
}

function createAcmeWorkspace(): LegacyWorkspaceRecord {
  const rootPath = 'C:\\Users\\demo\\Projects\\acme'
  const workspacePackages: LegacyWorkspacePackage[] = [
    {
      id: 'admin-portal',
      name: 'admin-portal',
      relativePath: 'admin-portal',
      absPath: `${rootPath}\\admin-portal`,
      scripts: { dev: 'vite --port 3004', build: 'vite build', test: 'vitest run' }
    },
    {
      id: 'register-app',
      name: 'register-app',
      relativePath: 'register-app',
      absPath: `${rootPath}\\register-app`,
      scripts: { dev: 'vite --port 3002 --base /register', build: 'vite build' }
    },
    {
      id: 'storefront-app',
      name: 'storefront-app',
      relativePath: 'storefront',
      absPath: `${rootPath}\\storefront`,
      scripts: { dev: 'vite --port 3001', build: 'vite build' }
    },
    {
      id: 'backoffice',
      name: 'backoffice',
      relativePath: 'backoffice',
      absPath: `${rootPath}\\backoffice`,
      scripts: { dev: 'vite --port 3003 --open', build: 'vite build' }
    },
    {
      id: 'marketing-site',
      name: 'marketing-site',
      relativePath: 'marketing-site',
      absPath: `${rootPath}\\marketing-site`,
      scripts: { dev: 'next dev -p 3000', build: 'next build' }
    },
    {
      id: 'data-app',
      name: 'data-app',
      relativePath: 'data-app',
      absPath: `${rootPath}\\data-app`,
      scripts: { dev: 'convex dev' }
    }
  ]

  return {
    id: 'project-acme',
    name: 'acme-monorepo',
    nameOverride: null,
    order: 0,
    rootPath,
    groupIds: ['active'],
    packageManager: 'pnpm',
    isMonorepo: true,
    rootScripts: {
      dev: 'turbo run dev',
      build: 'turbo run build',
      test: 'turbo run test'
    },
    workspacePackages,
    docker: {
      composeFile: 'compose.yml',
      dockerfile: 'Dockerfile',
      services: ['postgres', 'redis', 'api']
    },
    pythonEnvironment: null,
    commandChains: {},
    favoriteCommandIds: ['project-acme::root::dev', 'project-acme::admin-portal::dev'],
    lastScanAt: Date.now() - 4 * 60_000,
    quickLinks: [
      { id: 'acme-repo', label: 'Repository', url: 'https://github.com/example/acme' },
      { id: 'acme-docs', label: 'Product Docs', url: 'https://docs.example.com/acme' }
    ],
    gitSummary: createGitSummary('Tighten workspace manager shell polish', 'main', true),
    gitWorktrees: [
      mockWorktree({
        path: rootPath,
        branch: 'main',
        head: 'abc123',
        isMain: true,
        isDirty: true,
        lastActivityAt: secondsAgo(12 * 60),
        lastActivityRelative: '12m ago'
      }),
      mockWorktree({
        path: `${rootPath}\\.worktrees\\feature-workspace-shell`,
        branch: 'feature/workspace-shell',
        head: 'def456',
        lastActivityAt: secondsAgo(10 * 24 * 60 * 60),
        lastActivityRelative: '10d ago'
      }),
      mockWorktree({
        path: `${rootPath}\\.worktrees\\chore-old-docs`,
        branch: 'chore/old-docs',
        head: 'ghi789',
        isDirty: true,
        lastActivityAt: secondsAgo(20 * 24 * 60 * 60),
        lastActivityRelative: '20d ago'
      })
    ],
    gitWorktreesRoot: `${rootPath}\\.worktrees`
  }
}

function createInventoryApiWorkspace(): LegacyWorkspaceRecord {
  const rootPath = 'C:\\Users\\demo\\Projects\\inventory-api'
  return {
    id: 'project-inventory-api',
    name: 'inventory-api',
    nameOverride: null,
    order: 1,
    rootPath,
    groupIds: ['services'],
    packageManager: 'pnpm',
    isMonorepo: false,
    rootScripts: {
      dev: 'tsx watch src/server.ts --port 4200',
      build: 'tsup src/server.ts',
      test: 'vitest run'
    },
    workspacePackages: [],
    docker: {
      composeFile: 'docker-compose.yml',
      dockerfile: 'Dockerfile',
      services: ['api', 'postgres']
    },
    pythonEnvironment: null,
    commandChains: {},
    favoriteCommandIds: ['project-inventory-api::root::dev'],
    lastScanAt: Date.now() - 16 * 60_000,
    quickLinks: [{ id: 'inventory-docs', label: 'Swagger', url: 'http://localhost:4200/docs' }],
    gitSummary: createGitSummary('Add typed healthcheck response', 'develop'),
    gitWorktrees: [],
    gitWorktreesRoot: null
  }
}

function createStudioWorkspace(): LegacyWorkspaceRecord {
  const rootPath = 'C:\\Users\\demo\\Projects\\studio-site'
  return {
    id: 'project-studio',
    name: 'studio-site',
    nameOverride: null,
    order: 2,
    rootPath,
    groupIds: ['client'],
    packageManager: 'pnpm',
    isMonorepo: false,
    rootScripts: {
      dev: 'vite --port 3100',
      build: 'vite build'
    },
    workspacePackages: [],
    docker: null,
    pythonEnvironment: null,
    commandChains: {},
    favoriteCommandIds: [],
    lastScanAt: Date.now() - 38 * 60_000,
    quickLinks: [{ id: 'studio-staging', label: 'Staging', url: 'https://staging.example.com/studio' }],
    gitSummary: createGitSummary('Refresh campaign hero and pricing copy'),
    gitWorktrees: [],
    gitWorktreesRoot: null
  }
}

function createSeedState(): BrowserPreviewState {
  const acme = createAcmeWorkspace()
  return {
    settings: normalizeSettings(), openTargets: {},
    ui: defaultUiState(),
    groups: [
      { id: 'active', name: 'Active', order: 0, color: '#68d391' },
      { id: 'client', name: 'Client', order: 1, color: '#76c5ff' },
      { id: 'services', name: 'Services', order: 2, color: null }
    ],
    workspaces: [acme, createInventoryApiWorkspace(), createStudioWorkspace()],
    terminals: [
      {
        id: 'session-acme-dev',
        projectId: null,
        workspaceId: acme.id,
        commandId: 'project-acme::root::dev',
        title: 'dev',
        pinned: true,
        workspacePaused: false,
        worktreePath: null,
        cwd: acme.rootPath,
        shellLine: 'pnpm run dev',
        pythonEnvironment: null,
        status: 'running',
        createdAt: Date.now() - 6 * 60_000,
        updatedAt: Date.now() - 40_000,
        exitCode: null,
        restorable: true,
        buffer: [
          'admin-portal:dev:',
          'admin-portal:dev:  VITE v6.4.1  ready in 323 ms',
          'admin-portal:dev:',
          'admin-portal:dev:  ➜  Local:   http://localhost:3004/',
          'admin-portal:dev:',
          'register-app:dev:',
          'register-app:dev:  VITE v5.4.21  ready in 381 ms',
          'register-app:dev:',
          'register-app:dev:  ➜  Local:   http://localhost:3002/register',
          'storefront:dev:',
          'storefront:dev:  VITE v6.4.1  ready in 572 ms',
          'storefront:dev:',
          'storefront:dev:  ➜  Local:   http://localhost:3001/',
          'backoffice:dev:',
          'backoffice:dev:  VITE v6.4.1  ready in 265 ms',
          'backoffice:dev:',
          'backoffice:dev:  ➜  Local:   http://localhost:3003/',
          'marketing-site:dev:',
          'marketing-site:dev:  ▲ Next.js 13.5.1',
          'marketing-site:dev:  - Local:    http://localhost:3000',
          'data-app:dev:',
          'data-app:dev:  ✔ Convex functions ready! (4.78s)'
        ].join('\n')
      }
    ]
  }
}

function loadState() {
  if (typeof localStorage === 'undefined') return createSeedState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()
    const parsed = JSON.parse(raw) as Partial<Pick<PersistedState, 'collections' | 'projects' | 'terminals'>> & { ui?: UiState; settings?: AppSettings; openTargets?: Record<string, OpenTarget | null> }
    return {
      settings: normalizeSettings(parsed.settings), openTargets: parsed.openTargets ?? {},
      ui: { ...defaultUiState(), ...parsed.ui },
      groups: (parsed.collections ?? createSeedState().groups).map((group) => ({ ...group, color: (group as Partial<GroupRecord>).color ?? null })),
      workspaces: (parsed.projects?.map(workspaceFromDisk) ?? createSeedState().workspaces).map(normalizeLegacyWorkspaceRecord),
      terminals: (parsed.terminals?.map(terminalFromDisk) ?? createSeedState().terminals).map((terminal) => ({
        ...terminal,
        pinned: terminal.pinned ?? false,
        workspacePaused: terminal.workspacePaused ?? false,
        pythonEnvironment: terminal.pythonEnvironment ?? null
      }))
    } satisfies BrowserPreviewState
  } catch {
    return createSeedState()
  }
}

let state = loadState()

function persistState() {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    settings: state.settings, openTargets: state.openTargets,
    ui: state.ui,
    collections: state.groups,
    projects: state.workspaces.map(workspaceToDisk),
    terminals: state.terminals.map(terminalToDisk)
  }))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function uniqueById<T extends { id: string }>(values: T[]) {
  return Array.from(new Map(values.map((value) => [value.id, value])).values())
}

function rankScriptName(name: string) {
  const normalized = name.toLowerCase()
  if (normalized === 'dev') return 100
  if (normalized === 'start') return 90
  if (normalized.endsWith(':dev')) return 85
  if (normalized.includes('dev')) return 82
  if (normalized.includes('serve')) return 78
  if (normalized.includes('watch')) return 76
  if (normalized.includes('build')) return 48
  if (normalized.includes('test')) return 42
  return 20
}

function sortCommands(left: CommandDescriptor, right: CommandDescriptor) {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1
  if (left.rank !== right.rank) return right.rank - left.rank
  return left.name.localeCompare(right.name)
}

function buildCommandDescriptor(
  workspace: LegacyWorkspaceRecord,
  scope: 'root' | 'project',
  name: string,
  script: string,
  project?: LegacyWorkspacePackage,
  options?: {
    id?: string
    title?: string
    rank?: number
  }
): CommandDescriptor {
  const id = options?.id ?? (project ? `${workspace.id}::${project.id}::${name}` : `${workspace.id}::root::${name}`)
  const favorite = workspace.favoriteCommandIds.includes(id)
  return {
    id,
    workspaceId: workspace.id,
    scope,
    projectId: project?.id,
    projectName: project?.name,
    name,
    script,
    title: options?.title ?? (project ? `${project.name} · ${name}` : name),
    packageManager: project?.packageManager ?? workspace.packageManager,
    cwd: project?.absPath ?? workspace.rootPath,
    rank: options?.rank ?? rankScriptName(name),
    favorite,
    prerequisiteCommandIds: [],
    prerequisiteTitles: [],
    hasChain: false
  }
}

function isSyntheticNodeInstall(commandId: string) {
  return commandId === NODE_INSTALL_COMMAND_ID || commandId.endsWith(`::${NODE_INSTALL_COMMAND_ID}`)
}

function isSyntheticPythonInstall(commandId: string) {
  return commandId === PYTHON_INSTALL_COMMAND_ID || commandId.endsWith(`::${PYTHON_INSTALL_COMMAND_ID}`)
}

function buildBrowserSyntheticCommands(workspace: LegacyWorkspaceRecord) {
  const commands: CommandDescriptor[] = []
  const packageManager = workspace.packageManager === 'unknown' ? 'npm' : workspace.packageManager

  if (workspace.packageManager !== 'unknown' && !workspace.rootScripts.install) {
    commands.push(
      buildCommandDescriptor(workspace, 'root', 'install', `${packageManager} install`, undefined, {
        id: `${workspace.id}::${NODE_INSTALL_COMMAND_ID}`,
        title: 'install',
        rank: 72
      })
    )
  }

  for (const project of workspace.workspacePackages) {
    if (project.scripts.install) continue
    const manager = project.packageManager ?? workspace.packageManager
    commands.push(buildCommandDescriptor(workspace, 'project', 'install', `${manager === 'unknown' ? 'npm' : manager} install`, project, {
      id: `${workspace.id}::${project.id}::${NODE_INSTALL_COMMAND_ID}`,
      rank: 72
    }))
  }

  if (workspace.pythonEnvironment && !workspace.rootScripts['python:install']) {
    commands.push(
      buildCommandDescriptor(
        workspace,
        'root',
        'python:install',
        `${workspace.pythonEnvironment.name}/python -m pip install -e .`,
        undefined,
        {
          id: `${workspace.id}::${PYTHON_INSTALL_COMMAND_ID}`,
          title: 'python:install',
          rank: 68
        }
      )
    )
  }

  return commands
}

function buildBrowserCommandIndex(workspace: LegacyWorkspaceRecord) {
  const commands = [
    ...Object.entries(workspace.rootScripts).map(([name, script]) =>
      buildCommandDescriptor(workspace, 'root', name, script)
    ),
    ...buildBrowserSyntheticCommands(workspace),
    ...workspace.workspacePackages.flatMap((project) =>
      Object.entries(project.scripts).map(([name, script]) =>
        buildCommandDescriptor(workspace, 'project', name, script, project)
      )
    )
  ]

  return new Map(commands.map((command) => [command.id, command]))
}

function attachBrowserChainMetadata(workspace: LegacyWorkspaceRecord, command: CommandDescriptor, commandIndex: Map<string, CommandDescriptor>) {
  const prerequisiteCommandIds = (workspace.commandChains[command.id] ?? []).filter((id) => commandIndex.has(id))
  return {
    ...command,
    prerequisiteCommandIds,
    prerequisiteTitles: prerequisiteCommandIds
      .map((id) => commandIndex.get(id)?.title)
      .filter((title): title is string => Boolean(title)),
    hasChain: prerequisiteCommandIds.length > 0
  } satisfies CommandDescriptor
}

function listBrowserCommands(workspace: LegacyWorkspaceRecord): CommandListResponse {
  const commandIndex = buildBrowserCommandIndex(workspace)
  const commands = [...commandIndex.values()].map((command) => ({
    ...attachBrowserChainMetadata(workspace, command, commandIndex), kind: 'script' as const
  }))
  // Group by detected project, like the main process, so the preview shows project headers.
  const groups = toRecord(workspace).projects.map((project) => ({
    key: project.id,
    title: project.name,
    projectId: project.id,
    relativePath: project.relativePath,
    capabilities: project.capabilities,
    commands: commands.filter((command) => (command.projectId ?? 'root') === project.id).sort(sortCommands)
  })).filter((group) => group.commands.length > 0)

  return {
    favorites: commands.filter((command) => command.favorite).sort(sortCommands),
    groups: groups satisfies CommandGroup[]
  }
}

function resolveBrowserSingleCommand(workspace: LegacyWorkspaceRecord, command: CommandDescriptor) {
  if (isSyntheticNodeInstall(command.id)) {
    return {
      commandId: command.id,
      title: command.title,
      cwd: command.cwd,
      shellLine: `${command.packageManager === 'unknown' ? 'npm' : command.packageManager} install`,
      pythonEnvironment: workspace.pythonEnvironment
    }
  }

  if (isSyntheticPythonInstall(command.id) && workspace.pythonEnvironment) {
    return {
      commandId: command.id,
      title: command.title,
      cwd: workspace.rootPath,
      shellLine: `${workspace.pythonEnvironment.name}/python -m pip install -e .`,
      pythonEnvironment: workspace.pythonEnvironment
    }
  }

  if (command.scope === 'project') {
    const project = workspace.workspacePackages.find((item) => item.id === command.projectId)
    if (project && workspace.packageManager === 'pnpm') {
      return {
        commandId: command.id,
        title: command.title,
        cwd: workspace.rootPath,
        shellLine: `pnpm --filter ${project.name} run ${command.name}`,
        pythonEnvironment: workspace.pythonEnvironment
      }
    }

    if (project) {
      return {
        commandId: command.id,
        title: command.title,
        cwd: project.absPath,
        shellLine: `${workspace.packageManager === 'unknown' ? 'npm' : workspace.packageManager} run ${command.name}`,
        pythonEnvironment: workspace.pythonEnvironment
      }
    }
  }

  return {
    commandId: command.id,
    title: command.title,
    cwd: workspace.rootPath,
    shellLine: `${workspace.packageManager === 'unknown' ? 'npm' : workspace.packageManager} run ${command.name}`,
    pythonEnvironment: workspace.pythonEnvironment
  }
}

function validateBrowserCommandChain(workspace: LegacyWorkspaceRecord, commandId: string, prerequisiteIds: string[]) {
  const uniqueIds = Array.from(new Set(prerequisiteIds))
  const commandIndex = buildBrowserCommandIndex(workspace)
  if (!commandIndex.has(commandId)) {
    throw new Error(`Unknown command: ${commandId}`)
  }

  for (const prerequisiteId of uniqueIds) {
    if (!commandIndex.has(prerequisiteId)) {
      throw new Error(`Unknown prerequisite command: ${prerequisiteId}`)
    }
    if (prerequisiteId === commandId) {
      throw new Error('A command cannot depend on itself.')
    }
  }

  const chainMap = { ...workspace.commandChains, [commandId]: uniqueIds }
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(nextCommandId: string) {
    if (visiting.has(nextCommandId)) throw new Error('Command prerequisite cycle detected.')
    if (visited.has(nextCommandId)) return
    visiting.add(nextCommandId)
    for (const prerequisiteId of chainMap[nextCommandId] ?? []) {
      visit(prerequisiteId)
    }
    visiting.delete(nextCommandId)
    visited.add(nextCommandId)
  }

  visit(commandId)
  return uniqueIds
}

function resolveBrowserCommandRunPlan(workspace: LegacyWorkspaceRecord, commandId: string): CommandRunPlan | null {
  const commandIndex = buildBrowserCommandIndex(workspace)
  const targetCommand = commandIndex.get(commandId)
  if (!targetCommand) return null

  const orderedIds: string[] = []
  const seen = new Set<string>()
  const visiting = new Set<string>()

  function visit(nextCommandId: string) {
    if (visiting.has(nextCommandId)) {
      throw new Error('Command prerequisite cycle detected.')
    }
    if (seen.has(nextCommandId)) return
    const nextCommand = commandIndex.get(nextCommandId)
    if (!nextCommand) {
      throw new Error(`Unknown prerequisite command: ${nextCommandId}`)
    }
    visiting.add(nextCommandId)
    for (const prerequisiteId of workspace.commandChains[nextCommandId] ?? []) {
      visit(prerequisiteId)
    }
    visiting.delete(nextCommandId)
    seen.add(nextCommandId)
    orderedIds.push(nextCommandId)
  }

  visit(commandId)
  const steps = orderedIds.map((resolvedCommandId) => resolveBrowserSingleCommand(workspace, commandIndex.get(resolvedCommandId)!))

  return {
    kind: steps.length > 1 ? 'chain' : 'single',
    commandId,
    title: targetCommand.title,
    shellLine: steps.length > 1 ? steps.map((step) => step.title).join(' -> ') : steps[0]?.shellLine ?? '',
    steps
  }
}

function buildDockerDescriptor(
  workspace: LegacyWorkspaceRecord,
  key: string,
  title: string,
  description: string,
  shellLine: string,
  rank: number
): DockerCommandDescriptor {
  return {
    id: `${workspace.id}::docker::${key}`,
    workspaceId: workspace.id,
    title,
    description,
    shellLine,
    cwd: workspace.rootPath,
    rank,
    prerequisiteCommandIds: [],
    prerequisiteTitles: [],
    hasChain: false
  }
}

function buildBrowserDockerCommandIndex(workspace: LegacyWorkspaceRecord) {
  return new Map(
    (listBrowserDockerCommands(workspace).groups.flatMap((group) => group.commands))
      .map((command) => [
        command.id,
        {
          ...command,
          prerequisiteCommandIds: [],
          prerequisiteTitles: [],
          hasChain: false
        } satisfies DockerCommandDescriptor
      ])
  )
}

function attachBrowserDockerChainMetadata(
  workspace: LegacyWorkspaceRecord,
  command: DockerCommandDescriptor,
  commandIndex: Map<string, DockerCommandDescriptor>
) {
  const prerequisiteCommandIds = (workspace.commandChains[command.id] ?? []).filter((id) => commandIndex.has(id))
  return {
    ...command,
    prerequisiteCommandIds,
    prerequisiteTitles: prerequisiteCommandIds
      .map((id) => commandIndex.get(id)?.title)
      .filter((title): title is string => Boolean(title)),
    hasChain: prerequisiteCommandIds.length > 0
  } satisfies DockerCommandDescriptor
}

function listBrowserDockerCommands(workspace: LegacyWorkspaceRecord): DockerCommandListResponse {
  if (!workspace.docker) return { groups: [] }
  const groups: DockerCommandListResponse['groups'] = []
  const composeBase = workspace.docker.composeFile ? `docker compose -f ${workspace.docker.composeFile}` : null

  if (composeBase) {
    groups.push({
      key: 'compose',
      title: 'Compose',
      commands: [
        buildDockerDescriptor(workspace, 'compose-up', 'Compose Up', 'Start the stack in attached mode', `${composeBase} up`, 100),
        buildDockerDescriptor(workspace, 'compose-build', 'Compose Build', 'Build compose services', `${composeBase} build`, 82),
        buildDockerDescriptor(workspace, 'compose-logs', 'Compose Logs', 'Stream logs for all services', `${composeBase} logs -f`, 80),
        buildDockerDescriptor(workspace, 'compose-down', 'Compose Down', 'Stop the stack', `${composeBase} down`, 48)
      ]
    })

    if (workspace.docker.services.length > 0) {
      groups.push({
        key: 'services',
        title: 'Services',
        commands: workspace.docker.services.flatMap((service) => ([
          buildDockerDescriptor(workspace, `service-up-${service}`, `${service} Up`, `Start ${service}`, `${composeBase} up ${service}`, 88),
          buildDockerDescriptor(workspace, `service-logs-${service}`, `${service} Logs`, `Stream ${service} logs`, `${composeBase} logs -f ${service}`, 72)
        ]))
      })
    }
  }

  if (workspace.docker.dockerfile) {
    groups.push({
      key: 'dockerfile',
      title: 'Dockerfile',
      commands: [
        buildDockerDescriptor(workspace, 'docker-build', 'Build Image', 'Build the root Dockerfile', `docker build -t ${workspace.name}:local -f ${workspace.docker.dockerfile} .`, 74)
      ]
    })
  }

  const commandIndex = new Map(
    groups.flatMap((group) => group.commands).map((command) => [command.id, command])
  )

  return {
    groups: groups.map((group) => ({
      ...group,
      commands: group.commands
        .map((command) => attachBrowserDockerChainMetadata(workspace, command, commandIndex))
        .sort((left, right) => right.rank - left.rank || left.title.localeCompare(right.title))
    }))
  }
}

function validateBrowserDockerChain(workspace: LegacyWorkspaceRecord, commandId: string, prerequisiteIds: string[]) {
  const uniqueIds = Array.from(new Set(prerequisiteIds))
  const commandIndex = buildBrowserDockerCommandIndex(workspace)
  if (!commandIndex.has(commandId)) {
    throw new Error(`Unknown docker command: ${commandId}`)
  }

  for (const prerequisiteId of uniqueIds) {
    if (!commandIndex.has(prerequisiteId)) {
      throw new Error(`Unknown prerequisite docker command: ${prerequisiteId}`)
    }
    if (prerequisiteId === commandId) {
      throw new Error('A command cannot depend on itself.')
    }
  }

  const chainMap = { ...workspace.commandChains, [commandId]: uniqueIds }
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(nextCommandId: string) {
    if (visiting.has(nextCommandId)) throw new Error('Command prerequisite cycle detected.')
    if (visited.has(nextCommandId)) return
    visiting.add(nextCommandId)
    for (const prerequisiteId of chainMap[nextCommandId] ?? []) {
      visit(prerequisiteId)
    }
    visiting.delete(nextCommandId)
    visited.add(nextCommandId)
  }

  visit(commandId)
  return uniqueIds
}

function resolveBrowserDockerExecution(workspace: LegacyWorkspaceRecord, commandId: string): CommandRunPlan | null {
  const commandIndex = buildBrowserDockerCommandIndex(workspace)
  const targetCommand = commandIndex.get(commandId)
  if (!targetCommand) return null

  const orderedIds: string[] = []
  const seen = new Set<string>()
  const visiting = new Set<string>()

  function visit(nextCommandId: string) {
    if (visiting.has(nextCommandId)) {
      throw new Error('Command prerequisite cycle detected.')
    }
    if (seen.has(nextCommandId)) return
    const nextCommand = commandIndex.get(nextCommandId)
    if (!nextCommand) {
      throw new Error(`Unknown prerequisite docker command: ${nextCommandId}`)
    }
    visiting.add(nextCommandId)
    for (const prerequisiteId of workspace.commandChains[nextCommandId] ?? []) {
      visit(prerequisiteId)
    }
    visiting.delete(nextCommandId)
    seen.add(nextCommandId)
    orderedIds.push(nextCommandId)
  }

  visit(commandId)

  const steps = orderedIds.map((resolvedCommandId) => {
    const command = commandIndex.get(resolvedCommandId)!
    return {
      commandId: command.id,
      title: command.title,
      cwd: command.cwd,
      shellLine: command.shellLine,
      pythonEnvironment: workspace.pythonEnvironment
    }
  })

  return {
    kind: steps.length > 1 ? 'chain' : 'single',
    commandId: targetCommand.id,
    title: targetCommand.title,
    shellLine: steps.length > 1 ? steps.map((step) => step.title).join(' -> ') : targetCommand.shellLine,
    steps
  }
}

function emitOutput(event: TerminalOutputEvent) {
  for (const listener of outputListeners) listener(event)
}

function emitExit(event: TerminalExitEvent) {
  for (const listener of exitListeners) listener(event)
}

function replaceTerminal(session: TerminalSession) {
  const terminals = [...state.terminals]
  const index = terminals.findIndex((item) => item.id === session.id)
  if (index >= 0) terminals[index] = session
  else terminals.unshift(session)
  state = { ...state, terminals }
  persistState()
  return session
}

function findWorkspace(workspaceId: string) {
  return state.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
}

function createTerminalBuffer(workspace: LegacyWorkspaceRecord, runPlan: CommandRunPlan) {
  const execution = runPlan.steps.at(-1)
  if (!execution) return '$ Command finished.\n'

  if (runPlan.commandId === 'project-acme::root::dev') {
    return createSeedState().terminals[0].buffer
  }

  if (execution.shellLine.includes('localhost') || execution.commandId.includes('::docker::')) {
    return `$ ${execution.shellLine}\nListening on http://localhost:8080\n`
  }

  if (/build/i.test(execution.shellLine)) {
    return `$ ${execution.shellLine}\nBuilding ${workspace.name}...\nBuild complete in 1.4s.\n`
  }

  if (/test/i.test(execution.shellLine)) {
    return `$ ${execution.shellLine}\n✓ 12 tests passed\n`
  }

  if (/dev|start|serve|watch|logs|up/i.test(execution.shellLine)) {
    const port = execution.commandId.includes('inventory-api') ? 4200 : 3100
    return `$ ${execution.shellLine}\nServer ready on http://localhost:${port}\n`
  }

  return `$ ${execution.shellLine}\nCommand finished.\n`
}

function scheduleExit(sessionId: string, exitCode = 0, delay = 900) {
  const existing = exitTimers.get(sessionId)
  if (existing) window.clearTimeout(existing)
  const timer = window.setTimeout(() => {
    exitTimers.delete(sessionId)
    const session = state.terminals.find((item) => item.id === sessionId)
    if (!session || session.status === 'stopped') return
    replaceTerminal({
      ...session,
      status: exitCode === 0 ? 'exited' : 'failed',
      exitCode,
      updatedAt: Date.now()
    })
    emitExit({ sessionId, exitCode })
  }, delay)
  exitTimers.set(sessionId, timer)
}

function runExecution(workspace: LegacyWorkspaceRecord, runPlan: CommandRunPlan, worktreePath: string | null) {
  const longRunning = isLongRunningRunPlan(runPlan)
  const execution = runPlan.steps.at(-1)
  if (!execution) {
    throw new Error('Empty command run plan.')
  }
  const session: TerminalSession = {
    id: crypto.randomUUID(),
    projectId: null,
    workspaceId: workspace.id,
    commandId: runPlan.commandId,
    title: runPlan.title,
    pinned: false,
    workspacePaused: false,
    worktreePath,
    cwd: execution.cwd,
    shellLine: runPlan.shellLine,
    pythonEnvironment: execution.pythonEnvironment,
    status: longRunning ? 'running' : 'exited',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    exitCode: longRunning ? null : 0,
    buffer: createTerminalBuffer(workspace, runPlan),
    restorable: true
  }

  replaceTerminal(session)
  if (!longRunning) {
    scheduleExit(session.id, 0, 10)
  }
  return clone(session)
}

function upsertWorkspace(workspace: LegacyWorkspaceRecord) {
  const workspaces = [...state.workspaces]
  const index = workspaces.findIndex((item) => item.id === workspace.id)
  if (index >= 0) workspaces[index] = workspace
  else workspaces.push(workspace)
  state = { ...state, workspaces }
  persistState()
  return workspace
}

function toRecord(workspace: LegacyWorkspaceRecord): WorkspaceRecord {
  return { ...normalizeWorkspaceRecord(workspaceFromLegacy(workspace, workspace.groupIds[0] ?? null)), openTarget: state.openTargets[workspace.id] ?? null }
}

function listRecords() {
  return state.workspaces.map(toRecord)
}

/** Write back group membership and order computed on the v12 view. */
function applyLayout(records: Array<Pick<WorkspaceRecord, 'id' | 'groupId' | 'order'>>) {
  const byId = new Map(records.map((record) => [record.id, record]))
  state = {
    ...state,
    workspaces: state.workspaces.map((workspace) => {
      const record = byId.get(workspace.id)
      return record ? { ...workspace, groupIds: record.groupId ? [record.groupId] : [], order: record.order } : workspace
    })
  }
  persistState()
  return listRecords()
}

function deleteWorkspace(workspaceId: string) {
  state = {
    ...state,
    workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId),
    terminals: state.terminals.filter((terminal) => terminal.workspaceId !== workspaceId)
  }
  persistState()
}

const browserCandidates: WorkspaceCandidate[] = [
  {
    rootPath: 'C:\\Users\\demo\\Projects\\tools-console',
    name: 'tools-console',
    hasGit: true,
    hasPackageJson: true
  },
  {
    rootPath: 'C:\\Users\\demo\\Projects\\sandbox-lab',
    name: 'sandbox-lab',
    hasGit: true,
    hasPackageJson: true
  }
]

function createWorkspaceFromCandidate(candidate: WorkspaceCandidate, groupId: string | null): LegacyWorkspaceRecord {
  return {
    id: `project-${candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: candidate.name,
    nameOverride: null,
    order: nextOrderInGroup(listRecords(), groupId),
    rootPath: candidate.rootPath,
    groupIds: groupId ? [groupId] : [],
    packageManager: 'pnpm',
    isMonorepo: false,
    rootScripts: { dev: 'vite --port 5174', build: 'vite build' },
    workspacePackages: [],
    docker: null,
    pythonEnvironment: null,
    commandChains: {},
    favoriteCommandIds: [],
    lastScanAt: Date.now(),
    quickLinks: [],
    gitSummary: createGitSummary(`Seeded ${candidate.name} preview workspace`),
    gitWorktrees: [],
    gitWorktreesRoot: null
  }
}

const browserApi: WorkspaceApi = {
  settings: {
    async get() { return clone(state.settings) },
    async update(patch) { state.settings = normalizeSettings({ ...state.settings, ...patch }); persistState(); return clone(state.settings) },
    async pickNodeCaCertificate() { return null },
    async platform() { return navigator.platform.toLowerCase().includes('win') ? 'win32' : navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux' }
  },
  ui: {
    async get() { return clone(normalizeUiState(state.ui, state.groups, state.workspaces.map(toRecord))) },
    async set(ui) {
      state.ui = normalizeUiState(ui, state.groups, state.workspaces.map(toRecord))
      persistState()
    }
  },
  groups: {
    async list() {
      return clone(sortByOrder(state.groups))
    },
    async create(input: GroupCreateInput) {
      const name = input.name.trim()
      if (!name) throw new Error('Group name cannot be empty.')
      const group = { id: `group-${crypto.randomUUID().slice(0, 8)}`, name, order: state.groups.length, color: normalizeGroupColor(input.color) }
      state = { ...state, groups: uniqueById([...state.groups, group]) }
      persistState()
      return clone(group)
    },
    async update(input: GroupUpdateInput) {
      const current = state.groups.find((group) => group.id === input.id)
      if (!current) return null
      const name = input.name === undefined ? current.name : input.name.trim()
      if (!name) throw new Error('Group name cannot be empty.')
      const next = { ...current, name, color: input.color === undefined ? current.color : normalizeGroupColor(input.color) }
      state = { ...state, groups: state.groups.map((group) => (group.id === input.id ? next : group)) }
      persistState()
      return clone(next)
    },
    async delete(id: string) {
      state = { ...state, groups: reorderGroups(state.groups.filter((group) => group.id !== id), []) }
      return clone(applyLayout(ungroupWorkspaces(listRecords(), id)))
    },
    async reorder(input) {
      const groups = reorderGroups(state.groups, input.ids)
      state = { ...state, groups }
      persistState()
      return clone(groups)
    }
  },
  workspaces: {
    async setOpenTarget(workspaceId, target) {
      const workspace = findWorkspace(workspaceId)
      if (!workspace) return null
      state.openTargets[workspaceId] = target; persistState(); return toRecord(workspace)
    },
    async startupRescan() {},
    subscribeUpdated: () => () => {},
    subscribeScanError: () => () => {},
    async importCandidates() {
      return clone(browserCandidates.filter((candidate) => !state.workspaces.some((workspace) => workspace.rootPath === candidate.rootPath)))
    },
    async add(input: AddWorkspacesInput) {
      const groupId = input.groupId && state.groups.some((group) => group.id === input.groupId) ? input.groupId : null
      const workspaces = input.candidates.map((candidate) => {
        const existing = state.workspaces.find((workspace) => workspace.rootPath === candidate.rootPath)
        if (existing) return toRecord(upsertWorkspace({ ...existing, lastScanAt: Date.now() }))
        return toRecord(upsertWorkspace(createWorkspaceFromCandidate(candidate, groupId)))
      })
      return clone(workspaces)
    },
    async remove(workspaceId: string) {
      deleteWorkspace(workspaceId)
    },
    async rescan(workspaceId: string) {
      const workspace = findWorkspace(workspaceId)
      if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`)
      return clone(toRecord(upsertWorkspace({ ...workspace, lastScanAt: Date.now() })))
    },
    async getDetails(workspaceId: string) {
      const workspace = findWorkspace(workspaceId)
      return workspace ? clone(toRecord(workspace)) : null
    },
    async list() {
      return clone(listRecords())
    },
    async move(input: MoveWorkspaceInput) {
      if (input.groupId && !state.groups.some((group) => group.id === input.groupId)) throw new Error(`Unknown group: ${input.groupId}`)
      return clone(applyLayout(moveWorkspaceToGroup(listRecords(), input)))
    },
    async rename(input) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) return null
      const trimmed = input.name.trim()
      if (!trimmed) throw new Error('Workspace name cannot be empty.')
      return clone(toRecord(upsertWorkspace({ ...workspace, name: trimmed, nameOverride: trimmed })))
    },
    async toggleFavoriteCommand(input: ToggleFavoriteInput) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) return null
      const favoriteCommandIds = workspace.favoriteCommandIds.includes(input.commandId)
        ? workspace.favoriteCommandIds.filter((id) => id !== input.commandId)
        : [...workspace.favoriteCommandIds, input.commandId]
      return clone(toRecord(upsertWorkspace({ ...workspace, favoriteCommandIds })))
    },
    async setCommandChain(input: SetCommandChainInput) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) return null
      const prerequisiteIds = input.commandId.includes('::docker::')
        ? validateBrowserDockerChain(workspace, input.commandId, input.prerequisiteIds)
        : validateBrowserCommandChain(workspace, input.commandId, input.prerequisiteIds)
      const commandChains = { ...workspace.commandChains }
      if (prerequisiteIds.length === 0) delete commandChains[input.commandId]
      else commandChains[input.commandId] = prerequisiteIds
      return clone(toRecord(upsertWorkspace({ ...workspace, commandChains })))
    },
    async setRunConfiguration(input: SetRunConfigurationInput) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) return null
      const runActions = Array.from(new Map(input.actions
        .map((action) => ({
          id: action.id.trim() || crypto.randomUUID(),
          command: action.command.trim(),
          description: action.description.trim()
        }))
        .filter((action) => action.command && action.description)
        .map((action) => [action.id, action])).values())
      const defaultRunActionId = input.defaultActionId && runActions.some((action) => action.id === input.defaultActionId)
        ? input.defaultActionId
        : runActions[0]?.id ?? null
      return clone(toRecord(upsertWorkspace({ ...workspace, runActions, defaultRunActionId })))
    },
    async setPinnedEndpoints(input: SetPinnedEndpointsInput) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) return null
      const endpoints = input.endpoints
        .map((endpoint) => ({ url: endpoint.url.trim(), label: endpoint.label.trim() }))
        .filter((endpoint) => {
          try {
            const protocol = new URL(endpoint.url).protocol
            return protocol === 'http:' || protocol === 'https:'
          } catch {
            return false
          }
        })
      const pinnedEndpoints = Array.from(new Map(endpoints.map((endpoint) => [endpoint.url, endpoint])).values())
      return clone(toRecord(upsertWorkspace({ ...workspace, pinnedEndpoints, pinnedPorts: [] })))
    }
  },
  commands: {
    async list(workspaceId: string) {
      const workspace = findWorkspace(workspaceId)
      return workspace ? listBrowserCommands(workspace) : { favorites: [], groups: [] }
    },
    async run(input: RunCommandInput) {
      const commandId = input.commandId
      const workspace = state.workspaces.find((item) =>
        listBrowserCommands(item).groups.some((group) => group.commands.some((command) => command.id === commandId))
      )
      if (!workspace) throw new Error(`Unknown command: ${commandId}`)
      let runPlan = resolveBrowserCommandRunPlan(workspace, commandId)
      if (!runPlan) throw new Error(`Unable to resolve command: ${commandId}`)
      const worktreePath = resolveWorktreePath(workspace, input.worktreePath)
      if (normalizeComparePath(worktreePath) !== normalizeComparePath(workspace.rootPath)) {
        runPlan = remapRunPlanToWorktree(workspace, worktreePath, runPlan)
      }
      return runExecution(workspace, runPlan, worktreePath)
    },
    async runCustom(input) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) throw new Error(`Unknown workspace: ${input.workspaceId}`)
      const runPlan = resolveRunActionPlan(workspace, input.actionId, input.worktreePath)
      if (!runPlan) throw new Error(`Unknown Run action: ${input.actionId}`)
      return runExecution(workspace, runPlan, resolveWorktreePath(workspace, input.worktreePath))
    }
  },
  docker: {
    async list(workspaceId: string) {
      const workspace = findWorkspace(workspaceId)
      return workspace ? listBrowserDockerCommands(workspace) : { groups: [] }
    },
    async run(input: RunCommandInput) {
      const commandId = input.commandId
      const workspace = state.workspaces.find((item) =>
        listBrowserDockerCommands(item).groups.some((group) => group.commands.some((command) => command.id === commandId))
      )
      if (!workspace) throw new Error(`Unknown docker command: ${commandId}`)
      let runPlan = resolveBrowserDockerExecution(workspace, commandId)
      if (!runPlan) throw new Error(`Unable to resolve docker command: ${commandId}`)
      const worktreePath = resolveWorktreePath(workspace, input.worktreePath)
      if (normalizeComparePath(worktreePath) !== normalizeComparePath(workspace.rootPath)) {
        runPlan = remapRunPlanToWorktree(workspace, worktreePath, runPlan)
      }
      return runExecution(workspace, runPlan, worktreePath)
    }
  },
  terminals: {
    async list() {
      return clone(state.terminals)
    },
    async write(sessionId: string, data: string) {
      const session = state.terminals.find((item) => item.id === sessionId)
      if (!session || session.status !== 'running') return
      if (containsDomRendererLeak(data)) return
      emitOutput({ sessionId, chunk: data })
    },
    async resize() {
      // The browser preview has no PTY to resize.
    },
    async stop(sessionId: string) {
      const session = state.terminals.find((item) => item.id === sessionId)
      if (!session) return null
      const next = replaceTerminal({ ...session, status: 'stopped', workspacePaused: false, exitCode: 0, updatedAt: Date.now() })
      const timer = exitTimers.get(sessionId)
      if (timer) {
        window.clearTimeout(timer)
        exitTimers.delete(sessionId)
      }
      return clone(next)
    },
    async stopAll() {
      const stopped: TerminalSession[] = []
      for (const session of state.terminals) {
        if (session.status !== 'running') continue
        const next = replaceTerminal({ ...session, status: 'stopped', workspacePaused: false, exitCode: 0, updatedAt: Date.now() })
        const timer = exitTimers.get(session.id)
        if (timer) {
          window.clearTimeout(timer)
          exitTimers.delete(session.id)
        }
        stopped.push(clone(next))
      }
      return stopped
    },
    async pauseWorkspace(workspaceId: string) {
      const paused: TerminalSession[] = []
      for (const session of state.terminals) {
        if (session.workspaceId !== workspaceId || session.status !== 'running') continue
        const next = replaceTerminal({
          ...session,
          status: 'stopped',
          workspacePaused: true,
          exitCode: 0,
          updatedAt: Date.now()
        })
        const timer = exitTimers.get(session.id)
        if (timer) {
          window.clearTimeout(timer)
          exitTimers.delete(session.id)
        }
        paused.push(clone(next))
      }
      return paused
    },
    async pauseGroup(groupId: string) {
      const paused: TerminalSession[] = []
      for (const workspace of state.workspaces.filter((entry) => entry.groupIds.includes(groupId))) {
        paused.push(...await browserApi.terminals.pauseWorkspace(workspace.id))
      }
      return paused
    },
    async killGroup(groupId: string) {
      const ids = new Set(state.workspaces.filter((entry) => entry.groupIds.includes(groupId)).map((entry) => entry.id))
      const removed = state.terminals.filter((entry) => ids.has(entry.workspaceId))
      for (const session of removed) {
        await browserApi.terminals.remove(session.id)
      }
      return clone(removed)
    },
    async resumeGroup(groupId: string) {
      const sessions: TerminalSession[] = []
      const warnings: string[] = []
      for (const workspace of state.workspaces.filter((entry) => entry.groupIds.includes(groupId))) {
        const result = await browserApi.terminals.resumeWorkspace(workspace.id)
        sessions.push(...result.sessions)
        warnings.push(...result.warnings)
      }
      return { sessions, warnings }
    },
    async resumeWorkspace(workspaceId: string) {
      const sessions: TerminalSession[] = []
      const warnings: string[] = []
      const pausedSessions = state.terminals.filter((session) => session.workspaceId === workspaceId && session.workspacePaused)
      for (const session of pausedSessions) {
        try {
          const next = await browserApi.terminals.restart(session.id)
          if (!next) throw new Error('Console no longer exists.')
          sessions.push(next)
        } catch (error) {
          warnings.push(`${session.title}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return { sessions, warnings }
    },
    async restart(sessionId: string) {
      const session = state.terminals.find((item) => item.id === sessionId)
      if (!session) return null
      const workspace = findWorkspace(session.workspaceId)
      if (!workspace) return null

      const timer = exitTimers.get(sessionId)
      if (timer) {
        window.clearTimeout(timer)
        exitTimers.delete(sessionId)
      }

      const nextRunPlan = session.commandId.includes('::docker::')
        ? resolveBrowserDockerExecution(workspace, session.commandId)
        : resolveRunActionPlan(workspace, session.commandId, session.worktreePath)
          ?? resolveBrowserCommandRunPlan(workspace, session.commandId)
          ?? {
            kind: 'single' as const,
            commandId: session.commandId,
            title: session.title,
            shellLine: session.shellLine,
            steps: [{
              commandId: session.commandId,
              title: session.title,
              cwd: session.cwd,
              shellLine: session.shellLine,
              pythonEnvironment: session.pythonEnvironment
            }]
          }
      if (!nextRunPlan) return null

      const nextSession: TerminalSession = {
        ...session,
        status: 'running',
        workspacePaused: false,
        exitCode: null,
        shellLine: nextRunPlan.shellLine,
        buffer: createTerminalBuffer(workspace, nextRunPlan),
        updatedAt: Date.now()
      }

      const next = replaceTerminal(nextSession)

      if (!isLongRunningRunPlan(nextRunPlan)) {
        scheduleExit(next.id, 0, 10)
      }

      return clone(next)
    },
    async clear(sessionId: string) {
      const session = state.terminals.find((item) => item.id === sessionId)
      if (!session) return null
      return clone(replaceTerminal({ ...session, buffer: '', updatedAt: Date.now() }))
    },
    async restore() {
      return clone(state.terminals)
    },
    async remove(sessionId: string) {
      const timer = exitTimers.get(sessionId)
      if (timer) window.clearTimeout(timer)
      exitTimers.delete(sessionId)
      state = { ...state, terminals: state.terminals.filter((terminal) => terminal.id !== sessionId) }
      persistState()
    },
    async rename(input: TerminalRenameInput) {
      const session = state.terminals.find((item) => item.id === input.sessionId)
      if (!session) return null
      return clone(replaceTerminal({ ...session, title: input.title.trim(), updatedAt: Date.now() }))
    },
    async togglePin(sessionId: string) {
      const session = state.terminals.find((item) => item.id === sessionId)
      if (!session) return null
      return clone(replaceTerminal({ ...session, pinned: !session.pinned, updatedAt: Date.now() }))
    },
    subscribeOutput(callback) {
      outputListeners.add(callback)
      return () => outputListeners.delete(callback)
    },
    subscribeExit(callback) {
      exitListeners.add(callback)
      return () => exitListeners.delete(callback)
    }
  },
  git: {
    async getSummary(workspaceId: string) {
      return clone(findWorkspace(workspaceId)?.gitSummary ?? null)
    },
    async convertRepoToWorktrees(workspaceId: string) {
      const workspace = findWorkspace(workspaceId)
      if (!workspace) throw new Error('Workspace not found.')
      const worktreesRoot = `${workspace.rootPath}\\.worktrees`
      const next = upsertWorkspace({
        ...workspace,
        gitWorktreesRoot: worktreesRoot,
        lastScanAt: Date.now()
      })
      return clone({ workspace: toRecord(next), worktreesRoot })
    },
    async createWorktree(input) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace?.gitWorktreesRoot) {
        throw new Error('Set up worktrees for this repository before adding a branch checkout.')
      }
      const branch = input.branch.trim()
      const worktreePath = `${workspace.gitWorktreesRoot}\\${branch.replace(/[\\/]/g, '-')}`
      const next = upsertWorkspace({
        ...workspace,
        gitWorktrees: [
          ...workspace.gitWorktrees,
          mockWorktree({
            path: worktreePath,
            branch,
            lastActivityAt: secondsAgo(1),
            lastActivityRelative: '1s ago'
          })
        ],
        lastScanAt: Date.now()
      })
      return clone({ workspace: toRecord(next), worktreePath })
    },
    async cleanupWorktrees(input) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) throw new Error('Workspace not found.')
      const requested = input.worktreePaths
        ? new Set(input.worktreePaths.map((path) => normalizeComparePath(path)))
        : null
      const protectPaths = [workspace.rootPath, ...(input.protectPaths ?? [])]
      const removedPaths: string[] = []
      const skipped: Array<{ path: string; reason: string }> = []
      const kept: GitWorktree[] = []

      for (const worktree of workspace.gitWorktrees) {
        if (requested && !requested.has(normalizeComparePath(worktree.path))) {
          kept.push(worktree)
          continue
        }
        const decision = classifyWorktreeForCleanup(worktree, {
          maxAgeDays: input.maxAgeDays,
          includeDirty: input.includeDirty,
          protectPaths
        })
        if (decision.eligible) {
          removedPaths.push(worktree.path)
          continue
        }
        kept.push(worktree)
        skipped.push({ path: worktree.path, reason: decision.reason })
      }

      const next = upsertWorkspace({
        ...workspace,
        gitWorktrees: kept,
        lastScanAt: Date.now()
      })
      return clone({ workspace: toRecord(next), removedPaths, skipped, errors: [] })
    },
    async removeWorktree(input) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) throw new Error('Workspace not found.')
      const target = workspace.gitWorktrees.find(
        (worktree) => normalizeComparePath(worktree.path) === normalizeComparePath(input.worktreePath)
      )
      if (!target) throw new Error(`No worktree at ${input.worktreePath}`)
      const blocked = worktreeRemoveBlockReason(target, [workspace.rootPath])
      if (blocked) throw new Error(blocked)

      const next = upsertWorkspace({
        ...workspace,
        gitWorktrees: workspace.gitWorktrees.filter(
          (worktree) => normalizeComparePath(worktree.path) !== normalizeComparePath(target.path)
        ),
        lastScanAt: Date.now()
      })
      return clone({ workspace: toRecord(next), worktreePath: target.path })
    }
  },
  links: {
    async list(workspaceId: string) {
      return clone(findWorkspace(workspaceId)?.quickLinks ?? [])
    },
    async upsert(input: LinkUpsertInput) {
      const workspace = findWorkspace(input.workspaceId)
      if (!workspace) return []
      const nextLink: QuickLink = {
        id: input.link.id ?? `link-${crypto.randomUUID().slice(0, 8)}`,
        label: input.link.label.trim(),
        url: input.link.url.trim()
      }
      const quickLinks = uniqueById([...workspace.quickLinks, nextLink])
      upsertWorkspace({ ...workspace, quickLinks })
      return clone(quickLinks)
    },
    async delete(workspaceId: string, linkId: string) {
      const workspace = findWorkspace(workspaceId)
      if (!workspace) return []
      const quickLinks = workspace.quickLinks.filter((link) => link.id !== linkId)
      upsertWorkspace({ ...workspace, quickLinks })
      return clone(quickLinks)
    }
  },
  system: {
    async openWorkspace(workspaceId, path) {
      const target = state.openTargets[workspaceId] ?? state.settings.defaultOpenTarget
      if (target === 'folder') return browserApi.system.openPath(path)
      if (target === 'terminal') return browserApi.system.openInTerminal(path)
      return browserApi.system.openInEditor(path, target)
    },
    subscribeAppChanged: () => () => {},
    async migrationNotes() { return [] },
    async clearMigrationNotes() {},
    async openInEditor(targetPath: string, editor?: EditorTarget) {
      console.info(`Browser preview cannot open ${editor ?? 'editor'} for ${targetPath}.`)
    },
    async openInTerminal(targetPath: string) {
      console.info(`Browser preview cannot open a terminal for ${targetPath}.`)
    },
    async openPath(targetPath: string) {
      console.info(`Browser preview cannot open Explorer for ${targetPath}.`)
    },
    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    async copyText(value: string) {
      try {
        await navigator.clipboard.writeText(value)
      } catch {
        console.info('Clipboard unavailable in browser preview.', value)
      }
    }
  }
}

export function ensureWorkspaceApi() {
  if (typeof window === 'undefined') return
  if (typeof window.workspaceApi !== 'undefined') return
  window.workspaceApi = browserApi
}
