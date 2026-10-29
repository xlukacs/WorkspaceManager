export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'unknown'
export type ShellPreference = 'powershell' | 'cmd' | 'bash'
export type EditorTarget = 'cursor' | 'vscode'

export interface QuickLink {
  id: string
  label: string
  url: string
}

export interface PinnedEndpoint {
  url: string
  label: string
}

export interface RunAction {
  id: string
  command: string
  description: string
}

export type ProjectCapability = 'node' | 'python' | 'docker'

export interface DetectedProject {
  id: string
  name: string
  relativePath: string
  capabilities: ProjectCapability[]
  source: 'root' | 'declared' | 'scanned'
  packageManager: PackageManager | null
  scripts: Record<string, string>
  docker: DockerConfig | null
  python: {
    venvRelativePath: string | null
    installSource: 'requirements' | 'pyproject' | null
  } | null
}

/** v11 package metadata, retained until the workspace schema migration. */
export interface LegacyWorkspacePackage {
  id: string
  name: string
  relativePath: string
  absPath: string
  scripts: Record<string, string>
  source?: DetectedProject['source']
  packageManager?: PackageManager | null
}

export interface DockerConfig {
  composeFile: string | null
  dockerfile: string | null
  services: string[]
}

export interface PythonEnvironment {
  id: string
  name: string
  kind: 'venv'
  rootPath: string
  scriptsPath: string
  pythonPath: string
}

export interface GitSummary {
  branch: string | null
  isDirty: boolean
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  lastCommitSubject: string | null
  lastCommitRelative: string | null
  lastCommitTimestamp: number | null
}

export interface GitWorktree {
  path: string
  branch: string | null
  head: string | null
  isMain: boolean
  isBare: boolean
  isLocked: boolean
  isDirty?: boolean
  isMissing?: boolean
  lastActivityAt?: number | null
  lastActivityRelative?: string | null
}

export type OpenTarget = 'cursor' | 'vscode' | 'folder' | 'terminal'

export interface GroupRecord {
  id: string
  name: string
  order: number
  color: string | null
}

export interface WorkspaceRecord extends Omit<LegacyWorkspaceRecord,
  'groupIds' | 'packageManager' | 'isMonorepo' | 'rootScripts' | 'workspacePackages' | 'docker' | 'pythonEnvironment' | 'pinnedPorts'> {
  groupId: string | null
  openTarget: OpenTarget | null
  projects: DetectedProject[]
}

export interface UiState {
  selectedGroupId: string
  selectedWorkspaceId: string | null
  selectedWorktreeByWorkspace: Record<string, string>
  sidebarCollapsed: boolean
  collapsedGroupIds: string[]
  consoleTabFilter: 'all' | 'worktree'
}

export type ExternalTerminalPreference = 'auto' | 'windows-terminal' | 'powershell' | 'cmd' | 'x-terminal-emulator' | 'gnome-terminal' | 'konsole' | 'xfce4-terminal' | 'kitty' | 'alacritty' | 'wezterm' | 'terminal' | 'iterm'
export interface AppSettings {
  preferredShell: ShellPreference
  nodeCaCertificate: string | null
  preferredExternalTerminal: ExternalTerminalPreference
  defaultOpenTarget: OpenTarget
  windowBounds?: { x?: number; y?: number; width: number; height: number; isMaximized: boolean }
}

export interface StoredState extends Omit<LegacyState, 'groups' | 'workspaces' | 'terminals' | 'settings'> {
  groups: GroupRecord[]
  workspaces: WorkspaceRecord[]
  terminals: TerminalSession[]
  migrationNotes: string[]
  settings: AppSettings
  ui: UiState
}

/** Compatibility view used by the existing panels until Phase 2C. */
export interface LegacyWorkspaceRecord {
  id: string
  name: string
  nameOverride: string | null
  order: number
  rootPath: string
  groupIds: string[]
  packageManager: PackageManager
  isMonorepo: boolean
  rootScripts: Record<string, string>
  workspacePackages: LegacyWorkspacePackage[]
  docker: DockerConfig | null
  pythonEnvironment: PythonEnvironment | null
  commandChains: Record<string, string[]>
  favoriteCommandIds: string[]
  runActions?: RunAction[]
  defaultRunActionId?: string | null
  pinnedEndpoints?: PinnedEndpoint[]
  /** @deprecated Migrated into pinnedEndpoints when the workspace is loaded. */
  pinnedPorts?: number[]
  lastScanAt: number
  quickLinks: QuickLink[]
  gitSummary: GitSummary | null
  gitWorktrees: GitWorktree[]
  gitWorktreesRoot: string | null
}

export interface ConvertRepoToWorktreesResult {
  workspace: WorkspaceRecord
  worktreesRoot: string
}

export interface CreateGitWorktreeInput {
  workspaceId: string
  branch: string
  createBranch?: boolean
}

export interface CreateGitWorktreeResult {
  workspace: WorkspaceRecord
  worktreePath: string
}

export interface CleanupGitWorktreesInput {
  workspaceId: string
  maxAgeDays: number
  includeDirty?: boolean
  protectPaths?: string[]
  worktreePaths?: string[]
}

export interface CleanupGitWorktreesSkipped {
  path: string
  reason: string
}

export interface CleanupGitWorktreesResult {
  workspace: WorkspaceRecord
  removedPaths: string[]
  skipped: CleanupGitWorktreesSkipped[]
  errors: string[]
}

export interface RemoveGitWorktreeInput {
  workspaceId: string
  worktreePath: string
}

export interface RemoveGitWorktreeResult {
  workspace: WorkspaceRecord
  worktreePath: string
}

export interface LegacyGroupRecord {
  id: string
  name: string
  order: number
}

export type CommandKind = 'script' | 'docker' | 'run-action'

export interface CommandDescriptor {
  id: string
  workspaceId: string
  scope: 'root' | 'project'
  kind?: CommandKind
  projectId?: string
  projectName?: string
  name: string
  script: string
  title: string
  packageManager: PackageManager
  cwd: string
  rank: number
  favorite: boolean
  prerequisiteCommandIds: string[]
  prerequisiteTitles: string[]
  hasChain: boolean
}

export interface CommandGroup {
  key: string
  title: string
  /** Set when the group is one detected project. */
  projectId?: string
  relativePath?: string
  capabilities?: ProjectCapability[]
  commands: CommandDescriptor[]
}

export interface CommandListResponse {
  favorites: CommandDescriptor[]
  groups: CommandGroup[]
}

export interface CommandExecutionPlan {
  commandId: string
  title: string
  cwd: string
  shellLine: string
  pythonEnvironment: PythonEnvironment | null
}

export interface CommandRunPlan {
  kind: 'single' | 'chain'
  commandId: string
  title: string
  shellLine: string
  steps: CommandExecutionPlan[]
}

export interface DockerCommandDescriptor {
  id: string
  workspaceId: string
  title: string
  description: string
  shellLine: string
  cwd: string
  rank: number
  prerequisiteCommandIds: string[]
  prerequisiteTitles: string[]
  hasChain: boolean
}

export interface DockerCommandGroup {
  key: string
  title: string
  commands: DockerCommandDescriptor[]
}

export interface DockerCommandListResponse {
  groups: DockerCommandGroup[]
}

export interface TerminalSession {
  id: string
  projectId: string | null
  workspaceId: string
  commandId: string
  title: string
  pinned: boolean
  workspacePaused: boolean
  /** Checkout path when the session was started; null uses the workspace root. */
  worktreePath: string | null
  cwd: string
  shellLine: string
  pythonEnvironment: PythonEnvironment | null
  status: 'running' | 'stopped' | 'exited' | 'failed'
  createdAt: number
  updatedAt: number
  exitCode: number | null
  buffer: string
  restorable: boolean
}

export interface RunCommandInput {
  commandId: string
  worktreePath?: string | null
}

export interface RunCustomCommandInput {
  workspaceId: string
  actionId: string
  worktreePath?: string | null
}

export interface LegacyState {
  version: number
  groups: LegacyGroupRecord[]
  workspaces: LegacyWorkspaceRecord[]
  terminals: TerminalSession[]
  settings: Pick<AppSettings, 'preferredShell' | 'windowBounds'> & Partial<Omit<AppSettings, 'preferredShell' | 'windowBounds'>>
}

export interface WorkspaceCandidate {
  rootPath: string
  name: string
  hasGit: boolean
  hasPackageJson: boolean
  isGitWorktree?: boolean
  sourceWorkspacePath?: string
}

export interface TerminalOutputEvent {
  sessionId: string
  chunk: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
}

export interface GroupCreateInput {
  name: string
  color?: string | null
}

export interface GroupUpdateInput {
  id: string
  name?: string
  /** `#rrggbb`, or null to clear. Omit to keep the current color. */
  color?: string | null
}

export interface LinkUpsertInput {
  workspaceId: string
  link: {
    id?: string
    label: string
    url: string
  }
}

export interface ImportCandidatesInput {
  mode: 'folders' | 'parent' | 'paths'
  paths?: string[]
}

export interface AddWorkspacesInput {
  candidates: WorkspaceCandidate[]
  /** Target group for new workspaces; null leaves them ungrouped. Existing workspaces keep their group. */
  groupId: string | null
}

export interface ReorderGroupsInput {
  ids: string[]
}

export interface MoveWorkspaceInput {
  workspaceId: string
  /** Destination group; null is the ungrouped section. */
  groupId: string | null
  /** Position within the destination group. */
  index: number
}

export interface RenameWorkspaceInput {
  workspaceId: string
  name: string
}

export interface ToggleFavoriteInput {
  workspaceId: string
  commandId: string
}

export interface SetCommandChainInput {
  workspaceId: string
  commandId: string
  prerequisiteIds: string[]
}

export interface SetRunConfigurationInput {
  workspaceId: string
  actions: RunAction[]
  defaultActionId: string | null
}

export interface TerminalRenameInput {
  sessionId: string
  title: string
}

export interface SetPinnedEndpointsInput {
  workspaceId: string
  endpoints: PinnedEndpoint[]
}

export interface ResumeTerminalsResult {
  sessions: TerminalSession[]
  warnings: string[]
}

export interface WorkspaceApi {
  settings: {
    get: () => Promise<AppSettings>
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>
    pickNodeCaCertificate: () => Promise<string | null>
    platform: () => Promise<'win32' | 'linux' | 'darwin'>
  }
  ui: {
    get: () => Promise<UiState>
    set: (state: UiState) => Promise<void>
  }
  groups: {
    list: () => Promise<GroupRecord[]>
    create: (input: GroupCreateInput) => Promise<GroupRecord>
    update: (input: GroupUpdateInput) => Promise<GroupRecord | null>
    /** Deletes the group; its workspaces become ungrouped. Returns the updated workspaces. */
    delete: (id: string) => Promise<WorkspaceRecord[]>
    reorder: (input: ReorderGroupsInput) => Promise<GroupRecord[]>
  }
  workspaces: {
    startupRescan: () => Promise<void>
    subscribeUpdated: (callback: (workspace: WorkspaceRecord) => void) => () => void
    subscribeScanError: (callback: (message: string) => void) => () => void
    importCandidates: (input: ImportCandidatesInput) => Promise<WorkspaceCandidate[]>
    add: (input: AddWorkspacesInput) => Promise<WorkspaceRecord[]>
    remove: (workspaceId: string) => Promise<void>
    rescan: (workspaceId: string) => Promise<WorkspaceRecord | null>
    getDetails: (workspaceId: string) => Promise<WorkspaceRecord | null>
    list: () => Promise<WorkspaceRecord[]>
    /** Moves a workspace within or between groups. Returns every workspace with updated orders. */
    move: (input: MoveWorkspaceInput) => Promise<WorkspaceRecord[]>
    rename: (input: RenameWorkspaceInput) => Promise<WorkspaceRecord | null>
    toggleFavoriteCommand: (input: ToggleFavoriteInput) => Promise<WorkspaceRecord | null>
    setCommandChain: (input: SetCommandChainInput) => Promise<WorkspaceRecord | null>
    setRunConfiguration: (input: SetRunConfigurationInput) => Promise<WorkspaceRecord | null>
    setOpenTarget: (workspaceId: string, openTarget: OpenTarget | null) => Promise<WorkspaceRecord | null>
    setPinnedEndpoints: (input: SetPinnedEndpointsInput) => Promise<WorkspaceRecord | null>
  }
  commands: {
    list: (workspaceId: string) => Promise<CommandListResponse>
    run: (input: RunCommandInput) => Promise<TerminalSession>
    runCustom: (input: RunCustomCommandInput) => Promise<TerminalSession>
  }
  docker: {
    list: (workspaceId: string) => Promise<DockerCommandListResponse>
    run: (input: RunCommandInput) => Promise<TerminalSession>
  }
  terminals: {
    list: () => Promise<TerminalSession[]>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    stop: (sessionId: string) => Promise<TerminalSession | null>
    stopAll: () => Promise<TerminalSession[]>
    pauseWorkspace: (workspaceId: string) => Promise<TerminalSession[]>
    resumeWorkspace: (workspaceId: string) => Promise<ResumeTerminalsResult>
    pauseGroup: (groupId: string) => Promise<TerminalSession[]>
    resumeGroup: (groupId: string) => Promise<ResumeTerminalsResult>
    killGroup: (groupId: string) => Promise<TerminalSession[]>
    restart: (sessionId: string) => Promise<TerminalSession | null>
    clear: (sessionId: string) => Promise<TerminalSession | null>
    restore: () => Promise<TerminalSession[]>
    remove: (sessionId: string) => Promise<void>
    rename: (input: TerminalRenameInput) => Promise<TerminalSession | null>
    togglePin: (sessionId: string) => Promise<TerminalSession | null>
    subscribeOutput: (callback: (event: TerminalOutputEvent) => void) => () => void
    subscribeExit: (callback: (event: TerminalExitEvent) => void) => () => void
  }
  git: {
    getSummary: (workspaceId: string) => Promise<GitSummary | null>
    convertRepoToWorktrees: (workspaceId: string) => Promise<ConvertRepoToWorktreesResult>
    createWorktree: (input: CreateGitWorktreeInput) => Promise<CreateGitWorktreeResult>
    cleanupWorktrees: (input: CleanupGitWorktreesInput) => Promise<CleanupGitWorktreesResult>
    removeWorktree: (input: RemoveGitWorktreeInput) => Promise<RemoveGitWorktreeResult>
  }
  links: {
    list: (workspaceId: string) => Promise<QuickLink[]>
    upsert: (input: LinkUpsertInput) => Promise<QuickLink[]>
    delete: (workspaceId: string, linkId: string) => Promise<QuickLink[]>
  }
  system: {
    subscribeAppChanged: (callback: (event: { sessionId?: string }) => void) => () => void
    migrationNotes: () => Promise<string[]>
    clearMigrationNotes: () => Promise<void>
    openWorkspace: (workspaceId: string, worktreePath: string) => Promise<void>
    openInEditor: (targetPath: string, editor?: EditorTarget) => Promise<void>
    openInTerminal: (targetPath: string) => Promise<void>
    openPath: (targetPath: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
    copyText: (value: string) => Promise<void>
  }
}

export function normalizeLegacyWorkspaceRecord(workspace: LegacyWorkspaceRecord): LegacyWorkspaceRecord {
  return {
    ...workspace,
    nameOverride: workspace.nameOverride ?? null,
    order: workspace.order ?? 0,
    docker: workspace.docker ?? null,
    pythonEnvironment: workspace.pythonEnvironment ?? null,
    commandChains: workspace.commandChains ?? {},
    runActions: workspace.runActions ?? [],
    defaultRunActionId: workspace.defaultRunActionId ?? null,
    pinnedEndpoints: workspace.pinnedEndpoints ?? Array.from(
      new Set((workspace.pinnedPorts ?? []).filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535))
    ).map((port) => ({ url: `http://localhost:${port}`, label: `localhost:${port}` })),
    gitWorktrees: (workspace.gitWorktrees ?? []).map(normalizeGitWorktree),
    gitWorktreesRoot: workspace.gitWorktreesRoot ?? null
  }
}

export function normalizeGitWorktree(worktree: GitWorktree): GitWorktree {
  return {
    ...worktree,
    isDirty: worktree.isDirty ?? false,
    isMissing: worktree.isMissing ?? false,
    lastActivityAt: worktree.lastActivityAt ?? null,
    lastActivityRelative: worktree.lastActivityRelative ?? null
  }
}

export function sortWorkspaces(workspaces: LegacyWorkspaceRecord[]) {
  return [...workspaces].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.name.localeCompare(right.name)
  })
}

declare global {
  interface Window {
    workspaceApi: WorkspaceApi
  }
}
