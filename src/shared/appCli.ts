export const APP_CLI_MAX_REQUEST_BYTES = 64 * 1024
export const APP_CLI_TIMEOUT_MS = 60_000
export type AppCliAction = 'ping' | 'add' | 'start' | 'run' | 'sessions' | 'stop' | 'pause' | 'resume' | 'kill-all' | 'focus' | 'output' | 'acquire' | 'lease-status' | 'renew' | 'release'
export interface AppCliRequest {
  action: AppCliAction
  workspace?: string
  group?: string
  argv?: string[]
  command?: string
  worktree?: string
  cwd?: string
  label?: string
  name?: string
  sessionId?: string
  running?: boolean
  limitKb?: number
  leaseId?: string
  leaseMs?: number
  timeoutMs?: number
}
export const MAX_LEASE_MS = 10 * 60_000
export interface WorkspaceLease {
  leaseId: string
  scope: string
  workspaceIds: string[]
  label: string | null
  state: 'queued' | 'started' | 'released' | 'expired'
  position: number
  requestedAt: number
  startedAt: number | null
  expiresAt: number | null
}
export interface AppCliEndpoint { port: number; token: string; storePath: string }
export type AppCliResponse = { ok: true; result: unknown } | { ok: false; error: string }
