import { isWorkspaceNavigationShortcut } from './workspaceShortcuts'
import { useEffect } from 'react'
import { useAppStore, visibleTerminals, filterVisibleWorkspaces } from '@renderer/store/useAppStore'

function isFormFieldTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isTerminalInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('.xterm'))
}

function hasModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey
}

export function useWorkspaceHotkeys() {
  const bootstrapped = useAppStore((state) => state.bootstrapped)
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const importDrawerOpen = useAppStore((state) => state.importDrawerOpen)
  const selectedWorkspaceId = useAppStore((state) => state.selectedWorkspaceId)
  const consoleFullscreen = useAppStore((state) => state.consoleFullscreen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const toggleConsoleFullscreen = useAppStore((state) => state.toggleConsoleFullscreen)
  const setConsoleFullscreen = useAppStore((state) => state.setConsoleFullscreen)
  const cycleActiveTerminal = useAppStore((state) => state.cycleActiveTerminal)
  const toggleActiveTerminalRunState = useAppStore((state) => state.toggleActiveTerminalRunState)

  useEffect(() => {
    if (!bootstrapped) return

    function onKeyDown(event: KeyboardEvent) {
      if (settingsOpen || importDrawerOpen || event.defaultPrevented || event.repeat) return

      const mod = hasModifier(event)
      const inFormField = isFormFieldTarget(event.target)
      const inTerminal = isTerminalInputTarget(event.target)

      if ((inFormField && (!inTerminal || !isWorkspaceNavigationShortcut(event))) || document.body.dataset.renamingConsole === 'true') return

      const state = useAppStore.getState()
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const workspace = filterVisibleWorkspaces(state.groups, state.workspaces, state.search)[Number(event.key) - 1]
        if (workspace) {
          event.preventDefault()
          void state.setSelectedWorkspace(workspace.id)
        }
        return
      }
      if (event.altKey && !mod && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const session = visibleTerminals(state)[Number(event.key) - 1]
        if (session) {
          event.preventDefault()
          state.setActiveTerminal(session.id)
        }
        return
      }
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e' && selectedWorkspaceId) {
        const path = state.getSelectedWorktreePath(selectedWorkspaceId)
        if (path) {
          event.preventDefault()
          void window.workspaceApi.system.openPath(path).catch((error) => useAppStore.setState({ lastActionError: String(error) }))
        }
        return
      }
      if (!mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'r' && !inTerminal && selectedWorkspaceId) {
        const session = visibleTerminals(state).find((entry) => entry.id === state.activeTerminalId) ?? visibleTerminals(state)[0]
        if (session) {
          event.preventDefault()
          void state.restartTerminal(session.id)
        }
        return
      }

      if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggleSidebar()
        return
      }

      if (!selectedWorkspaceId) return

      if (mod && event.key === 'ArrowLeft') {
        event.preventDefault()
        cycleActiveTerminal(-1)
        return
      }

      if (mod && event.key === 'ArrowRight') {
        event.preventDefault()
        cycleActiveTerminal(1)
        return
      }

      if (mod && event.key === 'Tab') {
        event.preventDefault()
        cycleActiveTerminal(event.shiftKey ? -1 : 1)
        return
      }

      if (!mod && !inTerminal && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault()
        toggleConsoleFullscreen()
        return
      }

      if ((event.key === ' ' || event.code === 'Space') && !inTerminal) {
        event.preventDefault()
        void toggleActiveTerminalRunState()
        return
      }

      if (event.key === 'Escape' && consoleFullscreen) {
        event.preventDefault()
        setConsoleFullscreen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    bootstrapped,
    consoleFullscreen,
    cycleActiveTerminal,
    importDrawerOpen,
    settingsOpen,
    selectedWorkspaceId,
    setConsoleFullscreen,
    toggleActiveTerminalRunState,
    toggleConsoleFullscreen,
    toggleSidebar
  ])
}
