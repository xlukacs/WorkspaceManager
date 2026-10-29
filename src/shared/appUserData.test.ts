import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_PROFILE_DIR, APP_STORE_FILE, migrateLegacyAppUserData } from '@shared/appUserData'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function files() {
  return { existsSync, mkdirSync, copyFileSync }
}

describe('app user data', () => {
  it('keeps the installer profile folder when it already has a store', () => {
    const appData = mkdtempSync(join(tmpdir(), 'wsm-appdata-')); roots.push(appData)
    const dest = join(appData, APP_PROFILE_DIR)
    mkdirSync(dest)
    writeFileSync(join(dest, APP_STORE_FILE), '{"version":12}')
    mkdirSync(join(appData, 'Workspace Manager'))
    writeFileSync(join(appData, 'Workspace Manager', APP_STORE_FILE), '{"version":11}')
    expect(migrateLegacyAppUserData(appData, files())).toBe(dest)
    expect(readFileSync(join(dest, APP_STORE_FILE), 'utf8')).toBe('{"version":12}')
  })

  it('copies a productName profile into the installer folder and does not move cli.json', () => {
    const appData = mkdtempSync(join(tmpdir(), 'wsm-appdata-')); roots.push(appData)
    const source = join(appData, 'Workspace Manager')
    mkdirSync(source)
    writeFileSync(join(source, APP_STORE_FILE), '{"version":12}')
    writeFileSync(join(source, 'window-state.json'), '{"bounds":{}}')
    writeFileSync(join(source, 'cli.json'), '{"port":1}')
    const dest = migrateLegacyAppUserData(appData, files())
    expect(dest).toBe(join(appData, APP_PROFILE_DIR))
    expect(readFileSync(join(dest, APP_STORE_FILE), 'utf8')).toBe('{"version":12}')
    expect(readFileSync(join(dest, 'window-state.json'), 'utf8')).toBe('{"bounds":{}}')
    expect(existsSync(join(dest, 'cli.json'))).toBe(false)
  })
})
