import { join } from 'node:path'

/** Same folder the Windows installer uses (`%APPDATA%\workspace-manager`). */
export const APP_PROFILE_DIR = 'workspace-manager'
export const APP_STORE_FILE = 'workspace-manager.json'
export const LEGACY_APP_PROFILE_DIRS = ['Workspace Manager', 'WorkspaceManager'] as const

export function appUserDataPath(appData: string) {
  return join(appData, APP_PROFILE_DIR)
}

export interface AppUserDataFiles {
  existsSync: (path: string) => boolean
  mkdirSync: (path: string, options: { recursive: true }) => unknown
  copyFileSync: (source: string, destination: string) => void
}

/** Move a productName/dev profile into the installer folder so installed wsm finds this app. */
export function migrateLegacyAppUserData(appData: string, files: AppUserDataFiles) {
  const dest = appUserDataPath(appData)
  const destStore = join(dest, APP_STORE_FILE)
  if (files.existsSync(destStore)) return dest
  for (const name of LEGACY_APP_PROFILE_DIRS) {
    const source = join(appData, name)
    const sourceStore = join(source, APP_STORE_FILE)
    if (!files.existsSync(sourceStore)) continue
    files.mkdirSync(dest, { recursive: true })
    for (const file of [APP_STORE_FILE, 'window-state.json', `${APP_STORE_FILE}.bak`, 'window-state.json.bak']) {
      const from = join(source, file)
      if (files.existsSync(from)) files.copyFileSync(from, join(dest, file))
    }
    break
  }
  return dest
}
