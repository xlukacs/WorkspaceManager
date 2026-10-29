import type { AppSettings, ExternalTerminalPreference, OpenTarget, ShellPreference } from './types'
export const OPEN_TARGETS: ReadonlyArray<{ value: OpenTarget; label: string }> = [
  { value: 'cursor', label: 'Cursor' }, { value: 'vscode', label: 'VS Code' }, { value: 'folder', label: 'Folder' }, { value: 'terminal', label: 'Terminal' }
]
export const EXTERNAL_TERMINALS: Record<'win32' | 'linux' | 'darwin', ReadonlyArray<{ value: ExternalTerminalPreference; label: string }>> = {
  win32: [{ value: 'auto', label: 'Automatic' }, { value: 'windows-terminal', label: 'Windows Terminal' }, { value: 'powershell', label: 'PowerShell' }, { value: 'cmd', label: 'Command Prompt' }],
  linux: [{ value: 'auto', label: 'Automatic' }, { value: 'x-terminal-emulator', label: 'System terminal' }, { value: 'gnome-terminal', label: 'GNOME Terminal' }, { value: 'konsole', label: 'Konsole' }, { value: 'xfce4-terminal', label: 'Xfce Terminal' }, { value: 'kitty', label: 'Kitty' }, { value: 'alacritty', label: 'Alacritty' }, { value: 'wezterm', label: 'WezTerm' }],
  darwin: [{ value: 'auto', label: 'Automatic' }, { value: 'terminal', label: 'Terminal' }, { value: 'iterm', label: 'iTerm' }]
}
export function normalizeSettings(input: Partial<AppSettings> = {}, preferredShell: ShellPreference = 'bash'): AppSettings {
  return {
    preferredShell: ['bash', 'powershell', 'cmd'].includes(input.preferredShell ?? '') ? input.preferredShell! : preferredShell,
    nodeCaCertificate: typeof input.nodeCaCertificate === 'string' && input.nodeCaCertificate.trim() ? input.nodeCaCertificate.trim() : null,
    preferredExternalTerminal: Object.values(EXTERNAL_TERMINALS).flat().some((entry) => entry.value === input.preferredExternalTerminal) ? input.preferredExternalTerminal! : 'auto',
    defaultOpenTarget: OPEN_TARGETS.some((entry) => entry.value === input.defaultOpenTarget) ? input.defaultOpenTarget! : 'cursor',
    ...(input.windowBounds ? { windowBounds: input.windowBounds } : {})
  }
}
export const SHORTCUT_REFERENCE = [
  ['Ctrl/Cmd+B', 'Toggle sidebar'], ['Ctrl/Cmd+Left / Right', 'Previous / next visible console'],
  ['Ctrl/Cmd+Tab / Shift+Tab', 'Cycle visible consoles'], ['Space', 'Stop or restart active console'],
  ['R', 'Restart active console'], ['F / Escape', 'Enter / exit console fullscreen'],
  ['Ctrl/Cmd+E', 'Open selected checkout in file manager'], ['Ctrl+1–9', 'Select workspace'],
  ['Alt+1–9', 'Select visible console'], ['Ctrl/Cmd+F', 'Find in console']
] as const
