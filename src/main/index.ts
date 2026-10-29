import { manageAppWindow } from '@main/services/appWindow'
import { startAppCliServer } from '@main/services/appCliServer'
import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { AppStore } from '@main/store'
import { registerIpc } from '@main/ipc'
import { createDebounced } from '@shared/debounce'
import appIcon from '../../build/icon.png?asset'

if (process.env.WORKSPACE_MANAGER_USER_DATA) app.setPath('userData', process.env.WORKSPACE_MANAGER_USER_DATA)
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
if (process.platform === 'linux' && is.dev) {
  app.commandLine.appendSwitch('no-sandbox')
}

function isVisibleOnAnyDisplay(bounds: { x?: number; y?: number; width: number; height: number }) {
  const { x, y, width, height } = bounds
  if (x === undefined || y === undefined) return true

  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const horizontallyVisible = x < area.x + area.width && x + width > area.x
    const verticallyVisible = y < area.y + area.height && y + height > area.y
    return horizontallyVisible && verticallyVisible
  })
}

function createWindow(store: AppStore) {
  const savedWindowBounds = store.getWindowBounds()
  const initialBounds = isVisibleOnAnyDisplay(savedWindowBounds)
    ? savedWindowBounds
    : { ...savedWindowBounds, x: undefined, y: undefined }

  const mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    icon: appIcon,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    backgroundColor: '#09101a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.removeMenu()

  const persistWindowState = () => {
    if (mainWindow.isDestroyed()) return
    const normalBounds = mainWindow.getNormalBounds()
    store.setWindowBounds({
      x: normalBounds.x,
      y: normalBounds.y,
      width: normalBounds.width,
      height: normalBounds.height,
      isMaximized: mainWindow.isMaximized()
    })
  }

  // Move/resize fire continuously; a sync store write here makes GNOME show
  // "Not Responding" until the main process catches up.
  const persistWindowStateSoon = createDebounced(persistWindowState, 300)

  mainWindow.on('ready-to-show', () => {
    if (savedWindowBounds.isMaximized) {
      mainWindow.maximize()
    }
    mainWindow.show()
  })

  mainWindow.on('resize', persistWindowStateSoon)
  mainWindow.on('move', persistWindowStateSoon)
  mainWindow.on('maximize', persistWindowState)
  mainWindow.on('unmaximize', persistWindowState)
  mainWindow.on('close', () => {
    persistWindowStateSoon.cancel()
    persistWindowState()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[workspace-manager] Renderer process gone:', details)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

if (ownsInstance) app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.xlukacs.workspacemanager')
  Menu.setApplicationMenu(null)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const store = new AppStore()
  let runtime: ReturnType<typeof registerIpc> | undefined
  const windows = manageAppWindow(() => createWindow(store), (window) => runtime?.setWindow(window))
  runtime = registerIpc(windows.get(), store, windows.get)
  app.on('second-instance', () => windows.focus())
  const { handleCli } = runtime
  const cliServer = await startAppCliServer({ directory: app.getPath('userData'), storePath: store.getStorePath(), handle: handleCli })
  app.once('before-quit', () => cliServer.close())
  process.once('exit', () => cliServer.close())

  app.on('activate', function () {
    windows.focus()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
