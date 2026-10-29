import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { TerminalManager, buildShellEnv } from '@main/services/terminalManager'
import type { CommandRunPlan, TerminalSession } from '@shared/types'

function createFakePty() {
  const listeners: Record<string, ((payload: any) => void)[]> = {
    data: [],
    exit: []
  }

  return {
    write: vi.fn((data: string) => {
      listeners.data.forEach((listener) => listener(data))
    }),
    kill: vi.fn(() => {
      listeners.exit.forEach((listener) => listener({ exitCode: 0 }))
    }),
    onData: (callback: (chunk: string) => void) => {
      listeners.data.push(callback)
    },
    onExit: (callback: (payload: { exitCode: number }) => void) => {
      listeners.exit.push(callback)
    }
  }
}

function createSingleRunPlan(shellLine = 'npm run dev'): CommandRunPlan {
  return {
    kind: 'single',
    commandId: 'cmd',
    title: 'Dev',
    shellLine,
    steps: [{
      commandId: 'cmd',
      title: 'Dev',
      cwd: '/tmp/demo',
      shellLine,
      pythonEnvironment: null
    }]
  }
}

describe('TerminalManager', () => {
  it('restores sessions without marking them running', () => {
    const manager = new TerminalManager({
      initialSessions: [{
        id: 'restored',
        projectId: null,
        workspaceId: 'project',
        commandId: 'cmd',
        title: 'Dev',
        pinned: false,
        workspacePaused: false,
        worktreePath: null,
        cwd: '/tmp/demo',
        shellLine: 'npm run dev',
        pythonEnvironment: null,
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
        exitCode: null,
        buffer: 'hello',
        restorable: true
      }],
      preferredShell: 'bash',
      onSessionChange: () => {}
    })

    expect(manager.restore()[0]?.status).toBe('stopped')
  })

  it('does not rewrite the session store while restoring', () => {
    const onSessionChange = vi.fn()
    const manager = new TerminalManager({
      initialSessions: [{
        id: 'restored',
        projectId: null,
        workspaceId: 'project',
        commandId: 'cmd',
        title: 'Dev',
        pinned: false,
        workspacePaused: false,
        worktreePath: null,
        cwd: '/tmp/demo',
        shellLine: 'npm run dev',
        pythonEnvironment: null,
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
        exitCode: null,
        buffer: 'hello',
        restorable: true
      }],
      preferredShell: 'bash',
      onSessionChange
    })

    expect(onSessionChange).not.toHaveBeenCalled()
    expect(manager.restore()).toHaveLength(1)
  })

  it('does not persist the session store on every output chunk', () => {
    vi.useFakeTimers()
    const onSessionChange = vi.fn()
    const pty = createFakePty()
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange,
      ptyFactory: () => pty
    })

    try {
      void manager.run({
        workspaceId: 'project',
        projectId: 'api',
        commandId: 'cmd',
        title: 'Dev',
        worktreePath: null,
        shellLine: 'npm run dev',
        runPlan: createSingleRunPlan()
      })

      const persistCountAfterStart = onSessionChange.mock.calls.length
      expect(manager.list()[0]).toMatchObject({ workspaceId: 'project', projectId: 'api' })
      expect(persistCountAfterStart).toBeGreaterThan(0)

      pty.write('chunk-a')
      pty.write('chunk-b')
      pty.write('chunk-c')
      expect(onSessionChange).toHaveBeenCalledTimes(persistCountAfterStart)

      vi.advanceTimersByTime(400)
      expect(onSessionChange.mock.calls.length).toBeGreaterThan(persistCountAfterStart)
      expect(manager.list()[0]?.buffer).toContain('chunk-c')
    } finally {
      vi.useRealTimers()
    }
  })

  it('synchronously kills every running terminal during shutdown', async () => {
    const ptys = [createFakePty(), createFakePty()]
    const queuedPtys = [...ptys]
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory: () => queuedPtys.shift()!
    })

    await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:first',
      title: 'First',
      worktreePath: null,
      shellLine: 'npm run dev',
      runPlan: createSingleRunPlan('npm run dev')
    })
    await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:second',
      title: 'Second',
      worktreePath: null,
      shellLine: 'pnpm dev',
      runPlan: createSingleRunPlan('pnpm dev')
    })

    manager.shutdown()

    expect(ptys[0].kill).toHaveBeenCalledOnce()
    expect(ptys[1].kill).toHaveBeenCalledOnce()
    expect(manager.list().every((session) => session.status === 'stopped')).toBe(true)
  })

  it('marks finite single-step commands as exited when the child process finishes', async () => {
    const exits: Array<{ sessionId: string; exitCode: number }> = []
    let sessions: TerminalSession[] = []
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'cmd',
      onSessionChange: (next) => {
        sessions = next
      }
    })
    manager.on('exit', (event) => exits.push(event))

    const session = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:build',
      title: 'build',
      worktreePath: null,
      shellLine: 'pnpm run build',
      runPlan: {
        ...createSingleRunPlan('echo workspace-build-ok'),
        steps: [{
          commandId: 'cmd:build',
          title: 'build',
          cwd: process.cwd(),
          shellLine: 'echo workspace-build-ok',
          pythonEnvironment: null
        }]
      }
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for finite command to exit'))
      }, 2000)
      if (exits.length > 0) {
        clearTimeout(timer)
        resolve()
        return
      }
      manager.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    const updated = sessions.find((item) => item.id === session.id)
    expect(updated?.status).toBe('exited')
    expect(updated?.exitCode).toBe(0)
    expect(exits).toHaveLength(1)
    expect(exits[0]?.sessionId).toBe(session.id)
  })

  it('captures single-step shell output and stop state', async () => {
    let sessions: TerminalSession[] = []
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: (next) => {
        sessions = next
      },
      ptyFactory: () => createFakePty()
    })

    const session = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd',
      title: 'Dev',
      worktreePath: null,
      shellLine: 'npm run dev',
      runPlan: createSingleRunPlan('npm run dev')
    })

    expect(sessions[0]?.id).toBe(session.id)
    expect(sessions[0]?.buffer).toContain('npm run dev')

    await manager.stop(session.id)
    expect(manager.list()[0]?.status).toBe('stopped')
  })

  it('runs sudo and other finite commands in a PTY so they can use /dev/tty', async () => {
    const pty = createFakePty()
    const ptyFactory = vi.fn(() => pty)
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory
    })

    const shellLine = 'sudo dpkg -i "release/Workspace Manager.deb"'
    await manager.run({
      workspaceId: 'project',
      commandId: 'install-package',
      title: 'Install package',
      worktreePath: null,
      shellLine,
      runPlan: createSingleRunPlan(shellLine)
    })

    expect(ptyFactory).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([shellLine])
    }))
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('gives custom run actions a PTY even when they are not dev servers', async () => {
    const ptyFactory = vi.fn(() => createFakePty())
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory
    })

    const shellLine = 'cd scanner && go run ./cmd/customer-scanner'
    await manager.run({
      workspaceId: 'project',
      commandId: 'run-scanner',
      title: 'run scanner',
      worktreePath: null,
      shellLine,
      runPlan: createSingleRunPlan(shellLine)
    })

    expect(ptyFactory).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([shellLine])
    }))
  })

  it('resizes the running PTY and starts new PTYs at the last renderer size', async () => {
    const ptys: Array<ReturnType<typeof createFakePty> & { resize: ReturnType<typeof vi.fn> }> = []
    const ptyFactory = vi.fn(() => {
      const pty = { ...createFakePty(), resize: vi.fn() }
      ptys.push(pty)
      return pty
    })
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory
    })
    const runInput = {
      workspaceId: 'project',
      commandId: 'cmd',
      title: 'Dev',
      worktreePath: null,
      shellLine: 'npm run dev',
      runPlan: createSingleRunPlan('npm run dev')
    }

    const first = await manager.run(runInput)
    expect(ptyFactory).toHaveBeenLastCalledWith(expect.objectContaining({ cols: 120, rows: 30 }))

    manager.resize(first.id, 211.6, 48)
    expect(ptys[0]?.resize).toHaveBeenCalledWith(211, 48)

    await manager.run(runInput)
    expect(ptyFactory).toHaveBeenLastCalledWith(expect.objectContaining({ cols: 211, rows: 48 }))

    // Restarting keeps the session's own size, and bad sizes are ignored or clamped.
    manager.resize(first.id, 0, Number.NaN)
    manager.resize(first.id, 90, 0)
    await manager.restart(first.id)
    expect(ptyFactory).toHaveBeenLastCalledWith(expect.objectContaining({ cols: 90, rows: 1 }))
  })

  it('ignores resize for sessions without a PTY', () => {
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {}
    })
    expect(() => manager.resize('missing', 100, 40)).not.toThrow()
  })

  it('can restart a stopped single-step session', async () => {
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory: () => createFakePty()
    })

    const session = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd',
      title: 'Dev',
      worktreePath: null,
      shellLine: 'npm run dev',
      runPlan: createSingleRunPlan('npm run dev')
    })

    await manager.stop(session.id)
    const restarted = await manager.restart(session.id)

    expect(restarted?.id).toBe(session.id)
    expect(restarted?.status).toBe('running')
    expect(restarted?.buffer).toContain('npm run dev')
  })

  it('pauses only running sessions for one project and marks the paused subset', async () => {
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory: () => createFakePty()
    })

    const first = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:first',
      title: 'First',
      worktreePath: null,
      shellLine: 'npm run first',
      runPlan: createSingleRunPlan('npm run first')
    })
    const alreadyStopped = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:stopped',
      title: 'Stopped',
      worktreePath: null,
      shellLine: 'npm run stopped',
      runPlan: createSingleRunPlan('npm run stopped')
    })
    const otherWorkspace = await manager.run({
      workspaceId: 'other-project',
      commandId: 'cmd:other',
      title: 'Other',
      worktreePath: null,
      shellLine: 'npm run other',
      runPlan: createSingleRunPlan('npm run other')
    })

    await manager.stop(alreadyStopped.id)
    const paused = await manager.pauseWorkspace('project')

    expect(paused.map((session) => session.id)).toEqual([first.id])
    expect(manager.list().find((session) => session.id === first.id)?.workspacePaused).toBe(true)
    expect(manager.list().find((session) => session.id === alreadyStopped.id)?.workspacePaused).toBe(false)
    expect(manager.list().find((session) => session.id === otherWorkspace.id)?.status).toBe('running')
  })

  it('resumes only workspace-paused sessions for a project', async () => {
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory: () => createFakePty()
    })

    const first = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:first',
      title: 'First',
      worktreePath: null,
      shellLine: 'npm run first',
      runPlan: createSingleRunPlan('npm run first')
    })
    const second = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:second',
      title: 'Second',
      worktreePath: null,
      shellLine: 'npm run second',
      runPlan: createSingleRunPlan('npm run second')
    })

    await manager.pauseWorkspace('project')
    const resumed = await manager.resumeWorkspace('project')

    expect(resumed.sessions.map((session) => session.id).sort()).toEqual([first.id, second.id].sort())
    expect(manager.list().filter((session) => session.workspaceId === 'project')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: 'running', workspacePaused: false }),
        expect.objectContaining({ id: second.id, status: 'running', workspacePaused: false })
      ])
    )
  })

  it('pauses every running console in a group across workspaces and worktrees, then resumes only that subset', async () => {
    const ptys: ReturnType<typeof createFakePty>[] = []
    const manager = new TerminalManager({
      initialSessions: [], preferredShell: 'bash', onSessionChange: () => {},
      ptyFactory: () => { const pty = createFakePty(); ptys.push(pty); return pty }
    })
    const start = (workspaceId: string, worktreePath: string | null = null) => manager.run({
      workspaceId, commandId: 'cmd', title: workspaceId, worktreePath,
      shellLine: 'npm run dev', runPlan: createSingleRunPlan()
    })
    const a = await start('api')
    const b = await start('api', '/tmp/feature')
    const c = await start('web')
    const stopped = await start('web')
    const outside = await start('other')
    await manager.stop(stopped.id)
    const paused = await manager.pauseGroup(['api', 'web', 'api'])
    expect(paused.map((entry) => entry.id).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(paused.every((entry) => entry.status === 'stopped' && entry.workspacePaused)).toBe(true)
    expect(ptys.slice(0, 3).every((pty) => pty.kill.mock.calls.length === 1)).toBe(true)
    expect(manager.list().find((entry) => entry.id === outside.id)?.status).toBe('running')
    const resumed = await manager.resumeGroup(['api', 'web'])
    expect(resumed.warnings).toEqual([])
    expect(resumed.sessions.map((entry) => entry.id).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(resumed.sessions.every((entry) => entry.status === 'running' && !entry.workspacePaused)).toBe(true)
    expect(manager.list().find((entry) => entry.id === stopped.id)?.status).toBe('stopped')
    expect(b.worktreePath).toBe('/tmp/feature')
    await manager.stopAll()
  })

  it('reports per-console resume failures, keeps them paused for retry, and continues with other group members', async () => {
    const manager = new TerminalManager({
      initialSessions: [], preferredShell: 'bash', onSessionChange: () => {},
      ptyFactory: () => createFakePty(),
      resolveSessionRun: async (session) => {
        if (session.workspaceId === 'bad') throw new Error('Selected worktree is missing.')
        return createSingleRunPlan()
      }
    })
    for (const workspaceId of ['bad', 'good']) {
      await manager.run({ workspaceId, commandId: 'cmd', title: workspaceId, worktreePath: null, shellLine: 'npm run dev', runPlan: createSingleRunPlan() })
    }
    await manager.pauseGroup(['bad', 'good'])
    const result = await manager.resumeGroup(['bad', 'good'])
    expect(result.sessions.map((entry) => entry.workspaceId)).toEqual(['good'])
    expect(result.warnings).toEqual(['bad: Selected worktree is missing.'])
    expect(manager.list().find((entry) => entry.workspaceId === 'bad')).toMatchObject({ workspacePaused: true, status: 'stopped' })
    const retry = await manager.resumeWorkspace('bad')
    expect(retry.warnings).toEqual(result.warnings)
    await manager.stopAll()
  })

  it('removes every group console and its pin/pause state from persisted history, leaving other workspaces alone', async () => {
    let persisted: TerminalSession[] = []
    const ptys: ReturnType<typeof createFakePty>[] = []
    const manager = new TerminalManager({ initialSessions: [], preferredShell: 'bash', onSessionChange: (sessions) => { persisted = sessions }, ptyFactory: () => {
      const pty = createFakePty(); ptys.push(pty); return pty
    } })
    for (const workspaceId of ['paused', 'running', 'stopped', 'exited', 'other']) {
      await manager.run({ workspaceId, commandId: 'cmd', title: workspaceId, worktreePath: null, shellLine: 'npm run dev', runPlan: createSingleRunPlan() })
    }
    await manager.pauseWorkspace('paused')
    const stopped = manager.list().find((entry) => entry.workspaceId === 'stopped')!
    await manager.stop(stopped.id)
    await manager.togglePin(stopped.id)
    ptys[3]!.kill()
    expect(manager.list().find((entry) => entry.workspaceId === 'exited')?.status).toBe('exited')
    const killed = await manager.killGroup(['paused', 'running', 'stopped', 'exited'])
    expect(killed).toHaveLength(4)
    expect(manager.list().map((entry) => entry.workspaceId)).toEqual(['other'])
    expect(persisted.map((entry) => entry.workspaceId)).toEqual(['other'])
    expect(await manager.resumeGroup(['paused', 'running', 'stopped', 'exited'])).toEqual({ sessions: [], warnings: [] })
    const restored = new TerminalManager({ initialSessions: persisted, preferredShell: 'bash', onSessionChange: () => {} })
    expect(restored.list().map((entry) => entry.workspaceId)).toEqual(['other'])
    expect(await manager.pauseGroup([])).toEqual([])
    await manager.stopAll()
  })

  it('stops a group without removing its console history or pins', async () => {
    const manager = new TerminalManager({ initialSessions: [], preferredShell: 'bash', onSessionChange: () => {}, ptyFactory: () => createFakePty() })
    const session = await manager.run({ workspaceId: 'web', commandId: 'cmd', title: 'Dev', worktreePath: null, shellLine: 'npm run dev', runPlan: createSingleRunPlan() })
    await manager.togglePin(session.id)
    await manager.pauseWorkspace('web')
    await manager.stopGroup(['web'])
    expect(manager.list()).toEqual([expect.objectContaining({ id: session.id, status: 'stopped', pinned: true, workspacePaused: false })])
  })

  it('uses the latest certificate settings when starting and restarting GUI consoles', async () => {
    let certificate: string | null = '/tmp/first CA.pem'
    const spawn = vi.fn((_input: { env: NodeJS.ProcessEnv }) => createFakePty())
    const manager = new TerminalManager({ initialSessions: [], preferredShell: 'bash', onSessionChange: () => {}, ptyFactory: spawn,
      getShellSettings: () => ({ preferredShell: 'bash', nodeCaCertificate: certificate }) })
    const session = await manager.run({ workspaceId: 'project', commandId: 'cmd', title: 'Dev', worktreePath: null, shellLine: 'npm run dev', runPlan: createSingleRunPlan() })
    expect(spawn.mock.calls[0]?.[0].env.NODE_EXTRA_CA_CERTS).toBe(certificate)
    certificate = '/tmp/second CA.pem'
    await manager.restart(session.id)
    expect(spawn.mock.calls[1]?.[0].env.NODE_EXTRA_CA_CERTS).toBe(certificate)
    await manager.stopAll()
  })

  it('executes chained steps sequentially and stops on first failure', async () => {
    let sessions: TerminalSession[] = []
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'cmd',
      onSessionChange: (next) => {
        sessions = next
      }
    })

    const failingCommand = platform() === 'win32' ? 'exit /b 1' : 'exit 1'
    const exited = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for chained session to fail'))
      }, 2000)
      manager.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    const session = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:chain',
      title: 'frontend:dev',
      worktreePath: null,
      shellLine: 'frontend -> frontend:dev',
      runPlan: {
        kind: 'chain',
        commandId: 'cmd:chain',
        title: 'frontend:dev',
        shellLine: 'frontend -> frontend:dev',
        steps: [
          {
            commandId: 'cmd:frontend',
            title: 'frontend',
            cwd: process.cwd(),
            shellLine: 'echo frontend-ready',
            pythonEnvironment: null
          },
          {
            commandId: 'cmd:broken',
            title: 'broken-step',
            cwd: process.cwd(),
            shellLine: failingCommand,
            pythonEnvironment: null
          },
          {
            commandId: 'cmd:dev',
            title: 'frontend:dev',
            cwd: process.cwd(),
            shellLine: 'echo should-not-run',
            pythonEnvironment: null
          }
        ]
      }
    })
    await exited

    const updated = sessions.find((item) => item.id === session.id)
    expect(updated?.buffer).toContain('[1/3] Running frontend')
    expect(updated?.buffer).toContain('frontend-ready')
    expect(updated?.buffer).toContain('[2/3] Running broken-step')
    expect(updated?.buffer).not.toContain('should-not-run')
    expect(updated?.status).toBe('failed')
  })

  it('reruns a chained session from resolved command id on restart', async () => {
    const manager = new TerminalManager({
      initialSessions: [{
        id: 'stopped-session',
        projectId: null,
        workspaceId: 'project',
        commandId: 'cmd:dev',
        title: 'frontend:dev',
        pinned: false,
        workspacePaused: false,
        worktreePath: null,
        cwd: process.cwd(),
        shellLine: 'frontend:dev',
        pythonEnvironment: null,
        status: 'stopped',
        createdAt: 1,
        updatedAt: 1,
        exitCode: 0,
        buffer: '',
        restorable: true
      }],
      preferredShell: 'cmd',
      onSessionChange: () => {},
      resolveSessionRun: async () => ({
        kind: 'chain',
        commandId: 'cmd:dev',
        title: 'frontend:dev',
        shellLine: 'frontend -> frontend:dev',
        steps: [
          {
            commandId: 'cmd:frontend',
            title: 'frontend',
            cwd: process.cwd(),
            shellLine: 'echo frontend-ready',
            pythonEnvironment: null
          },
          {
            commandId: 'cmd:dev',
            title: 'frontend:dev',
            cwd: process.cwd(),
            shellLine: 'echo frontend-dev-ready',
            pythonEnvironment: null
          }
        ]
      })
    })

    const restarted = await manager.restart('stopped-session')

    expect(restarted?.shellLine).toBe('frontend -> frontend:dev')
    expect(restarted?.status).toBe('running')
  })

  it('can pin, rename, and remove sessions', async () => {
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory: () => createFakePty()
    })

    const first = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:first',
      title: 'Frontend',
      worktreePath: null,
      shellLine: 'pnpm run dev',
      runPlan: {
        ...createSingleRunPlan('pnpm run dev'),
        commandId: 'cmd:first',
        title: 'Frontend'
      }
    })
    const second = await manager.run({
      workspaceId: 'project',
      commandId: 'cmd:second',
      title: 'API',
      worktreePath: null,
      shellLine: 'pnpm run api',
      runPlan: {
        ...createSingleRunPlan('pnpm run api'),
        commandId: 'cmd:second',
        title: 'API',
        steps: [{
          commandId: 'cmd:second',
          title: 'API',
          cwd: '/tmp/demo',
          shellLine: 'pnpm run api',
          pythonEnvironment: null
        }]
      }
    })

    const pinned = await manager.togglePin(first.id)
    expect(pinned?.pinned).toBe(true)
    expect(manager.list()[0]?.id).toBe(first.id)

    const renamed = await manager.rename(first.id, 'Frontend Core')
    expect(renamed?.title).toBe('Frontend Core')

    await manager.remove(second.id)
    expect(manager.list().map((session) => session.id)).toEqual([first.id])
  })

  it('injects detected python environment into terminal env', async () => {
    const captured: { env: NodeJS.ProcessEnv | null } = { env: null }
    const manager = new TerminalManager({
      initialSessions: [],
      preferredShell: 'bash',
      onSessionChange: () => {},
      ptyFactory: (options) => {
        captured.env = options.env
        return createFakePty()
      }
    })

    await manager.run({
      workspaceId: 'project',
      commandId: 'cmd',
      title: 'Python API',
      worktreePath: null,
      shellLine: 'python main.py --watch',
      runPlan: {
        kind: 'single',
        commandId: 'cmd',
        title: 'Python API',
        shellLine: 'python main.py --watch',
        steps: [{
          commandId: 'cmd',
          title: 'Python API',
          cwd: '/tmp/demo',
          shellLine: 'python main.py --watch',
          pythonEnvironment: {
            id: 'venv',
            name: '.venv',
            kind: 'venv',
            rootPath: '/tmp/demo/.venv',
            scriptsPath: '/tmp/demo/.venv/bin',
            pythonPath: '/tmp/demo/.venv/bin/python'
          }
        }]
      }
    })

    expect(captured.env?.VIRTUAL_ENV).toBe('/tmp/demo/.venv')
    expect(captured.env?.PATH?.startsWith('/tmp/demo/.venv/bin')).toBe(true)
  })

  it.runIf(process.platform !== 'win32')('adds user toolchain paths to terminal env', async () => {
    const captured: { env: NodeJS.ProcessEnv | null } = { env: null }
    const originalHome = process.env.HOME
    const originalPath = process.env.PATH
    const homePath = mkdtempSync(join(tmpdir(), 'workspace-manager-home-'))
    const nvmBinPath = join(homePath, '.nvm', 'versions', 'node', 'v24.16.0', 'bin')
    const pnpmHomePath = join(homePath, '.local', 'share', 'pnpm')
    const goBinPath = join(homePath, '.local', 'go', 'bin')
    mkdirSync(nvmBinPath, { recursive: true })
    mkdirSync(pnpmHomePath, { recursive: true })
    mkdirSync(goBinPath, { recursive: true })
    process.env.HOME = homePath
    process.env.PATH = ['/usr/bin', '/bin'].join(delimiter)

    try {
      const manager = new TerminalManager({
        initialSessions: [],
        preferredShell: 'bash',
        onSessionChange: () => {},
        ptyFactory: (options) => {
          captured.env = options.env
          return createFakePty()
        }
      })

      await manager.run({
        workspaceId: 'project',
        commandId: 'cmd',
        title: 'Dev',
        worktreePath: null,
        shellLine: 'pnpm run dev',
        runPlan: createSingleRunPlan('pnpm run dev')
      })
    } finally {
      if (originalHome === undefined) delete process.env.HOME
      else process.env.HOME = originalHome
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      rmSync(homePath, { recursive: true, force: true })
    }

    expect(captured.env?.PATH?.split(delimiter)).toEqual(
      expect.arrayContaining([nvmBinPath, pnpmHomePath, goBinPath])
    )
  })

  it.runIf(process.platform !== 'win32')('falls back to bash when pwsh is unavailable', async () => {
    let capturedShell: string | null = null
    let capturedArgs: string[] | string = []
    const originalPath = process.env.PATH
    // Hosted Linux runners may have pwsh in /usr/bin. Control its absence
    // without depending on the host's installed shells.
    const emptyPath = mkdtempSync(join(tmpdir(), 'workspace-manager-no-pwsh-'))
    process.env.PATH = emptyPath

    try {
      const manager = new TerminalManager({
        initialSessions: [],
        preferredShell: 'powershell',
        onSessionChange: () => {},
        ptyFactory: (options) => {
          capturedShell = options.shell
          capturedArgs = options.args
          return createFakePty()
        }
      })

      await manager.run({
        workspaceId: 'project',
        commandId: 'cmd',
        title: 'Dev',
        worktreePath: null,
        shellLine: 'pnpm run dev',
        runPlan: {
          kind: 'single',
          commandId: 'cmd',
          title: 'Dev',
          shellLine: 'pnpm run dev',
          steps: [{
            commandId: 'cmd',
            title: 'Dev',
            cwd: '/tmp/demo',
            shellLine: 'pnpm run dev',
            pythonEnvironment: null
          }]
        }
      })
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      rmSync(emptyPath, { recursive: true, force: true })
    }

    expect(capturedShell).toBe('/bin/bash')
    expect(capturedArgs).toEqual(['-lc', 'pnpm run dev'])
  })

  it('uses plain docker compose output for non-interactive chains', () => {
    const env = buildShellEnv(null, { interactive: false })

    expect(env.BUILDKIT_PROGRESS).toBe('plain')
    expect(env.COMPOSE_ANSI).toBe('never')
    expect(env.COLORTERM).toBeUndefined()
  })

  it('keeps colored compose output for interactive pty sessions', () => {
    const previousTerm = process.env.TERM
    delete process.env.TERM

    try {
      const env = buildShellEnv(null, { interactive: true })

      expect(env.COMPOSE_ANSI).toBe('always')
      expect(env.TERM).toBe('xterm-256color')
      expect(env.BUILDKIT_PROGRESS).toBeUndefined()
      expect(env.COMPOSE_PROGRESS).not.toBe('plain')
    } finally {
      if (previousTerm === undefined) delete process.env.TERM
      else process.env.TERM = previousTerm
    }
  })
})
