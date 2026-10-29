import { useEffect, useState } from 'react'
import type { AppSettings, OpenTarget } from '@shared/types'
import { EXTERNAL_TERMINALS, OPEN_TARGETS, SHORTCUT_REFERENCE } from '@shared/settings'
import { useAppStore, useSelectedWorkspace } from '@renderer/store/useAppStore'

export function SettingsDialog() {
  const settings = useAppStore((state) => state.settings)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const setWorkspaceOpenTarget = useAppStore((state) => state.setWorkspaceOpenTarget)
  const workspace = useSelectedWorkspace()
  const [platform, setPlatform] = useState<'win32' | 'linux' | 'darwin'>('linux')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.workspaceApi.settings.platform().then(setPlatform).catch((error) => setError(String(error)))
  }, [])
  async function save(patch: Partial<AppSettings>) {
    setBusy(true); setError(null)
    try { await saveSettings(patch) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return (
    <div className="worktrees-dialog-backdrop" onClick={() => setSettingsOpen(false)}>
      <section className="worktrees-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setSettingsOpen(false) }}>
        <header className="worktrees-dialog-head">
          <div><p className="eyebrow">Preferences</p><h2 id="settings-title">Settings</h2></div>
          <button type="button" autoFocus onClick={() => setSettingsOpen(false)} aria-label="Close settings">Close</button>
        </header>
        <div className="worktrees-dialog-body">
          {error && <p role="alert" className="worktrees-dialog-error">{error}</p>}
          <fieldset className="settings-fields" disabled={busy}>
            <label>Node CA certificate
              <input readOnly value={settings.nodeCaCertificate ?? ''} placeholder="Use system certificates" />
            </label>
            <div className="settings-file-actions">
              <button type="button" onClick={() => {
                void window.workspaceApi.settings.pickNodeCaCertificate().then((path) => path ? save({ nodeCaCertificate: path }) : undefined).catch((error) => setError(String(error)))
              }}>Choose certificate…</button>
              <button type="button" disabled={!settings.nodeCaCertificate} onClick={() => void save({ nodeCaCertificate: null })}>Clear certificate</button>
            </div>
            <label>External terminal
              <select value={settings.preferredExternalTerminal} onChange={(event) => void save({ preferredExternalTerminal: event.target.value as AppSettings['preferredExternalTerminal'] })}>
                {EXTERNAL_TERMINALS[platform].map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            <label>Default Open target
              <select value={settings.defaultOpenTarget} onChange={(event) => void save({ defaultOpenTarget: event.target.value as OpenTarget })}>
                {OPEN_TARGETS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            {workspace && <label>Open target for {workspace.name}
              <select value={workspace.openTarget ?? ''} onChange={(event) => {
                setError(null)
                void setWorkspaceOpenTarget(workspace.id, event.target.value ? event.target.value as OpenTarget : null).catch((error) => setError(String(error)))
              }}>
                <option value="">Use default</option>
                {OPEN_TARGETS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>}
            <label>Console shell
              <select value={settings.preferredShell} onChange={(event) => void save({ preferredShell: event.target.value as AppSettings['preferredShell'] })}>
                {platform !== 'win32' && <option value="bash">Bash</option>}
                <option value="powershell">PowerShell</option>
                {platform === 'win32' && <option value="cmd">Command Prompt</option>}
              </select>
            </label>
          </fieldset>
          <p className="muted">Changes save automatically and apply to newly started or restarted consoles. Open always uses the selected checkout.</p>
          <h3>Keyboard shortcuts</h3>
          <p className="muted">Plain-letter shortcuts apply outside terminal input and text fields.</p>
          <table className="settings-shortcuts"><tbody>{SHORTCUT_REFERENCE.map(([keys, description]) => <tr key={keys}><td><kbd>{keys}</kbd></td><td>{description}</td></tr>)}</tbody></table>
        </div>
      </section>
    </div>
  )
}
