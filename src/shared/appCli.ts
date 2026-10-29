export const APP_CLI_MAX_REQUEST_BYTES = 64 * 1024
export const APP_CLI_TIMEOUT_MS = 60_000
export type AppCliAction = 'ping' | 'add' | 'start' | 'sessions' | 'stop' | 'pause' | 'resume' | 'kill-all' | 'focus' | 'output'
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
}
export interface AppCliEndpoint { port: number; token: string; storePath: string }
export type AppCliResponse = { ok: true; result: unknown } | { ok: false; error: string }
