/** Keys reserved by the app must bubble past xterm without being sent to the shell. */
export function isWorkspaceNavigationShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
  const mod = event.ctrlKey || event.metaKey
  const digit = /^[1-9]$/.test(event.key)
  if (event.altKey) return !mod && !event.shiftKey && digit
  if (!mod) return false
  if (event.key === 'Tab') return true
  return !event.shiftKey && (
    (event.ctrlKey && !event.metaKey && digit) || ['b', 'e', 'arrowleft', 'arrowright'].includes(event.key.toLowerCase())
  )
}
