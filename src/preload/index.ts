import { contextBridge, ipcRenderer } from 'electron'
import type { WorkspaceApi } from '@shared/types'

const api: WorkspaceApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings.get'),
    update: (patch) => ipcRenderer.invoke('settings.update', patch),
    platform: () => ipcRenderer.invoke('settings.platform'),
    pickNodeCaCertificate: () => ipcRenderer.invoke('settings.pickNodeCaCertificate')
  },
  ui: {
    get: () => ipcRenderer.invoke('ui.get'),
    set: (state) => ipcRenderer.invoke('ui.set', state)
  },
  groups: {
    list: () => ipcRenderer.invoke('groups.list'),
    create: (input) => ipcRenderer.invoke('groups.create', input),
    update: (input) => ipcRenderer.invoke('groups.update', input),
    delete: (id) => ipcRenderer.invoke('groups.delete', id),
    reorder: (input) => ipcRenderer.invoke('groups.reorder', input)
  },
  workspaces: {
    setOpenTarget: (workspaceId, target) => ipcRenderer.invoke('workspaces.setOpenTarget', workspaceId, target),
    startupRescan: () => ipcRenderer.invoke('workspaces.startupRescan'),
    subscribeUpdated: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, workspace: Parameters<typeof callback>[0]) => callback(workspace)
      ipcRenderer.on('workspaces:updated', listener)
      return () => ipcRenderer.removeListener('workspaces:updated', listener)
    },
    subscribeScanError: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
      ipcRenderer.on('workspaces:scan-error', listener)
      return () => ipcRenderer.removeListener('workspaces:scan-error', listener)
    },
    importCandidates: (input) => ipcRenderer.invoke('workspaces.importCandidates', input),
    add: (input) => ipcRenderer.invoke('workspaces.add', input),
    remove: (workspaceId) => ipcRenderer.invoke('workspaces.remove', workspaceId),
    rescan: (workspaceId) => ipcRenderer.invoke('workspaces.rescan', workspaceId),
    getDetails: (workspaceId) => ipcRenderer.invoke('workspaces.getDetails', workspaceId),
    list: () => ipcRenderer.invoke('workspaces.list'),
    move: (input) => ipcRenderer.invoke('workspaces.move', input),
    rename: (input) => ipcRenderer.invoke('workspaces.rename', input),
    toggleFavoriteCommand: (input) => ipcRenderer.invoke('workspaces.toggleFavoriteCommand', input),
    setCommandChain: (input) => ipcRenderer.invoke('workspaces.setCommandChain', input),
    setRunConfiguration: (input) => ipcRenderer.invoke('workspaces.setRunConfiguration', input),
    setPinnedEndpoints: (input) => ipcRenderer.invoke('workspaces.setPinnedEndpoints', input)
  },
  commands: {
    list: (workspaceId) => ipcRenderer.invoke('commands.list', workspaceId),
    run: (input) => ipcRenderer.invoke('commands.run', input),
    runCustom: (input) => ipcRenderer.invoke('commands.runCustom', input)
  },
  docker: {
    list: (workspaceId) => ipcRenderer.invoke('docker.list', workspaceId),
    run: (input) => ipcRenderer.invoke('docker.run', input)
  },
  terminals: {
    list: () => ipcRenderer.invoke('terminals.list'),
    restore: () => ipcRenderer.invoke('terminals.restore'),
    write: (sessionId, data) => ipcRenderer.invoke('terminals.write', sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke('terminals.resize', sessionId, cols, rows),
    stop: (sessionId) => ipcRenderer.invoke('terminals.stop', sessionId),
    stopAll: () => ipcRenderer.invoke('terminals.stopAll'),
    pauseWorkspace: (workspaceId) => ipcRenderer.invoke('terminals.pauseWorkspace', workspaceId),
    resumeWorkspace: (workspaceId) => ipcRenderer.invoke('terminals.resumeWorkspace', workspaceId),
    pauseGroup: (groupId) => ipcRenderer.invoke('terminals.pauseGroup', groupId),
    resumeGroup: (groupId) => ipcRenderer.invoke('terminals.resumeGroup', groupId),
    killGroup: (groupId) => ipcRenderer.invoke('terminals.killGroup', groupId),
    restart: (sessionId) => ipcRenderer.invoke('terminals.restart', sessionId),
    clear: (sessionId) => ipcRenderer.invoke('terminals.clear', sessionId),
    remove: (sessionId) => ipcRenderer.invoke('terminals.remove', sessionId),
    rename: (input) => ipcRenderer.invoke('terminals.rename', input),
    togglePin: (sessionId) => ipcRenderer.invoke('terminals.togglePin', sessionId),
    subscribeOutput: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload)
      ipcRenderer.on('terminals:output', listener)
      return () => ipcRenderer.removeListener('terminals:output', listener)
    },
    subscribeExit: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload)
      ipcRenderer.on('terminals:exit', listener)
      return () => ipcRenderer.removeListener('terminals:exit', listener)
    }
  },
  git: {
    getSummary: (workspaceId) => ipcRenderer.invoke('git.getSummary', workspaceId),
    convertRepoToWorktrees: (workspaceId) => ipcRenderer.invoke('git.convertRepoToWorktrees', workspaceId),
    createWorktree: (input) => ipcRenderer.invoke('git.createWorktree', input),
    cleanupWorktrees: (input) => ipcRenderer.invoke('git.cleanupWorktrees', input),
    removeWorktree: (input) => ipcRenderer.invoke('git.removeWorktree', input)
  },
  links: {
    list: (workspaceId) => ipcRenderer.invoke('links.list', workspaceId),
    upsert: (input) => ipcRenderer.invoke('links.upsert', input),
    delete: (workspaceId, linkId) => ipcRenderer.invoke('links.delete', workspaceId, linkId)
  },
  system: {
    openWorkspace: (workspaceId, path) => ipcRenderer.invoke('system.openWorkspace', workspaceId, path),
    subscribeAppChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, event: { sessionId?: string }) => callback(event)
      ipcRenderer.on('app:changed', listener)
      return () => ipcRenderer.removeListener('app:changed', listener)
    },
    migrationNotes: () => ipcRenderer.invoke('system.migrationNotes'),
    clearMigrationNotes: () => ipcRenderer.invoke('system.clearMigrationNotes'),
    openInEditor: (targetPath, editor) => ipcRenderer.invoke('system.openInEditor', targetPath, editor),
    openInTerminal: (targetPath) => ipcRenderer.invoke('system.openInTerminal', targetPath),
    openPath: (targetPath) => ipcRenderer.invoke('system.openPath', targetPath),
    openExternal: (url) => ipcRenderer.invoke('system.openExternal', url),
    copyText: (value) => ipcRenderer.invoke('system.copyText', value)
  }
}

contextBridge.exposeInMainWorld('workspaceApi', api)
