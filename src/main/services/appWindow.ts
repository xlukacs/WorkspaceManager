interface AppWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}
/** Keep focus and IPC attached to the current window after a macOS window closes. */
export function manageAppWindow<T extends AppWindow>(create: () => T, attached: (window: T) => void) {
  let current: T | null = null
  const get = () => {
    if (!current || current.isDestroyed()) { current = create(); attached(current) }
    return current
  }
  return { get, focus() { const window = get(); if (window.isMinimized()) window.restore(); window.show(); window.focus() } }
}
