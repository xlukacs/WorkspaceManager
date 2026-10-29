type FitHost = { fit: () => void }
type TerminalHost = { element?: { isConnected: boolean; parentElement: unknown } | null }

export function isXtermRenderable(terminal: TerminalHost | null | undefined) {
  const element = terminal?.element
  return Boolean(element?.isConnected && element.parentElement)
}

/** FitAddon.fit() reads renderService.dimensions and throws if the renderer is gone. */
export function fitXtermSafely(fitAddon: FitHost | null | undefined, terminal: TerminalHost | null | undefined) {
  if (!fitAddon || !isXtermRenderable(terminal)) return false
  try {
    fitAddon.fit()
    return true
  } catch {
    return false
  }
}
