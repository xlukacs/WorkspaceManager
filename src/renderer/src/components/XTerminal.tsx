import { isWorkspaceNavigationShortcut } from '@renderer/hooks/workspaceShortcuts'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchResultChangeEvent } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { TerminalSession } from '@shared/types'
import { containsDomRendererLeak, appendTerminalBuffer, diffTerminalBuffer, sanitizeTerminalBuffer } from '@shared/terminalBuffer'
import { createDebounced } from '@shared/debounce'
import { useAppStore } from '@renderer/store/useAppStore'

export interface XTerminalHandle {
  copy: () => void
  openSearch: () => void
  blur: () => void
}

const PTY_RESIZE_DEBOUNCE_MS = 80

const searchOptions = {
  decorations: {
    matchBackground: '#5b4a20',
    matchBorder: '#ffc857',
    matchOverviewRuler: '#ffc857',
    activeMatchBackground: '#ffc857',
    activeMatchBorder: '#fff2c2',
    activeMatchColorOverviewRuler: '#fff2c2'
  }
}

function attachGpuRenderer(terminal: Terminal) {
  // Linux Electron often loses WebGL contexts; stay on the DOM renderer there.
  if (typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent)) return undefined

  try {
    const webglAddon = new WebglAddon()
    webglAddon.onContextLoss(() => {
      webglAddon.dispose()
    })
    terminal.loadAddon(webglAddon)
    return webglAddon
  } catch {
    return undefined
  }
}

function writeTerminal(terminal: Terminal, data: string, follow: boolean) {
  if (!data) {
    if (follow) terminal.scrollToBottom()
    return
  }

  const buffer = terminal.buffer.active
  const atBottom = follow || buffer.viewportY >= buffer.baseY
  terminal.write(data, () => {
    if (atBottom) terminal.scrollToBottom()
  })
}

export const XTerminal = memo(forwardRef<XTerminalHandle, { session: TerminalSession }>(function XTerminal(
  { session },
  ref
) {
  const consoleFullscreen = useAppStore((state) => state.consoleFullscreen)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastBufferRef = useRef('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResult, setSearchResult] = useState<ISearchResultChangeEvent>({ resultIndex: 0, resultCount: 0 })
  const [copyToastMessage, setCopyToastMessage] = useState<string | null>(null)

  const showCopyToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setCopyToastMessage(message)
    toastTimerRef.current = setTimeout(() => setCopyToastMessage(null), 2200)
  }, [])

  const copyText = useCallback(async (value: string, source: 'Console' | 'Selection') => {
    if (!value) return
    await window.workspaceApi.system.copyText(value)
    showCopyToast(`${source} copied successfully.`)
  }, [showCopyToast])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const closeSearch = useCallback(() => {
    searchRef.current?.clearDecorations()
    setSearchOpen(false)
    terminalRef.current?.focus()
  }, [])

  const find = useCallback((direction: 'next' | 'previous', incremental = false) => {
    const addon = searchRef.current
    if (!addon || !searchTerm) return
    if (direction === 'previous') {
      addon.findPrevious(searchTerm, searchOptions)
    } else {
      addon.findNext(searchTerm, { ...searchOptions, incremental })
    }
  }, [searchTerm])

  useImperativeHandle(ref, () => ({
    copy() {
      const terminal = terminalRef.current
      if (!terminal) return
      if (terminal.hasSelection()) {
        void copyText(terminal.getSelection(), 'Selection')
        return
      }
      const buffer = terminal.buffer.active
      let value = ''
      let hasLine = false
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index)
        if (!line) continue
        const text = line.translateToString(true)
        value += line.isWrapped ? text : `${hasLine ? '\n' : ''}${text}`
        hasLine = true
      }
      void copyText(value, 'Console')
    },
    openSearch,
    blur() {
      terminalRef.current?.blur()
    }
  }), [copyText, openSearch])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: false,
      convertEol: true,
      scrollback: 4_000,
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      theme: {
        background: '#070c13',
        foreground: '#edf0f5',
        cursor: '#ffc857',
        black: '#09101a',
        red: '#ff6978',
        green: '#68d391',
        yellow: '#ffc857',
        blue: '#76c5ff',
        magenta: '#c084fc',
        cyan: '#7dd3fc',
        white: '#f8fafc',
        brightBlack: '#314158',
        brightRed: '#ff8f9a',
        brightGreen: '#9ae6b4',
        brightYellow: '#ffd879',
        brightBlue: '#a5d8ff',
        brightMagenta: '#d8b4fe',
        brightCyan: '#a5f3fc',
        brightWhite: '#ffffff'
      }
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)

    terminal.open(container)
    const rendererAddon = attachGpuRenderer(terminal)

    // Tell the PTY its size so full-screen programs and line wrapping match the view.
    let sentSize = ''
    const sendSize = createDebounced(() => {
      const size = `${terminal.cols}x${terminal.rows}`
      if (size === sentSize) return
      sentSize = size
      void window.workspaceApi.terminals.resize(session.id, terminal.cols, terminal.rows)
    }, PTY_RESIZE_DEBOUNCE_MS)
    const resizeDisposable = terminal.onResize(() => sendSize())

    requestAnimationFrame(() => {
      fitAddon.fit()
      terminal.scrollToBottom()
      sendSize()
    })

    const syncCursorBlink = () => {
      terminal.options.cursorBlink = document.activeElement === terminal.textarea
    }
    terminal.textarea?.addEventListener('focus', syncCursorBlink)
    terminal.textarea?.addEventListener('blur', syncCursorBlink)

    const initialBuffer = sanitizeTerminalBuffer(session.buffer)
    terminal.write(initialBuffer)
    terminal.onData((data) => {
      if (containsDomRendererLeak(data)) return
      window.workspaceApi.terminals.write(session.id, data)
    })
    terminal.attachCustomKeyEventHandler((event) => {
      if (document.body.dataset.renamingConsole === 'true') return false
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        if (!active.classList.contains('xterm-helper-textarea')) return false
      }
      if (event.type !== 'keydown') return true
      if (isWorkspaceNavigationShortcut(event)) return false
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
        void copyText(terminal.getSelection(), 'Selection')
        terminal.clearSelection()
        return false
      }
      return true
    })

    terminalRef.current = terminal
    fitRef.current = fitAddon
    searchRef.current = searchAddon
    lastBufferRef.current = initialBuffer

    const searchResultDisposable = searchAddon.onDidChangeResults(setSearchResult)
    const onContextMenu = (event: MouseEvent) => {
      if (!terminal.hasSelection()) return
      event.preventDefault()
      void copyText(terminal.getSelection(), 'Selection')
      terminal.clearSelection()
    }
    container.addEventListener('contextmenu', onContextMenu)

    let lastWidth = 0
    let lastHeight = 0
    let pendingWidth = 0
    let pendingHeight = 0
    let fitFrame = 0
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      pendingWidth = Math.round(rect.width)
      pendingHeight = Math.round(rect.height)
      if (fitFrame !== 0) return
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0
        if (pendingWidth === lastWidth && pendingHeight === lastHeight) return
        lastWidth = pendingWidth
        lastHeight = pendingHeight
        const buffer = terminal.buffer.active
        const atBottom = buffer.viewportY >= buffer.baseY
        fitAddon.fit()
        if (atBottom) terminal.scrollToBottom()
      })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      if (fitFrame !== 0) cancelAnimationFrame(fitFrame)
      sendSize.cancel()
      resizeDisposable.dispose()
      terminal.textarea?.removeEventListener('focus', syncCursorBlink)
      terminal.textarea?.removeEventListener('blur', syncCursorBlink)
      container.removeEventListener('contextmenu', onContextMenu)
      searchResultDisposable.dispose()
      rendererAddon?.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
  }, [copyText, session.id])

  useEffect(() => {
    if (typeof window.workspaceApi === 'undefined') return

    return window.workspaceApi.terminals.subscribeOutput((event) => {
      if (event.sessionId !== session.id) return
      if (containsDomRendererLeak(event.chunk)) return
      const terminal = terminalRef.current
      if (!terminal) return
      lastBufferRef.current = appendTerminalBuffer(lastBufferRef.current, event.chunk)
      writeTerminal(terminal, event.chunk, false)
    })
  }, [session.id])

  useEffect(() => {
    const onFindShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      if (document.body.dataset.renamingConsole === 'true') return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      event.stopImmediatePropagation()
      openSearch()
    }

    window.addEventListener('keydown', onFindShortcut, true)
    return () => window.removeEventListener('keydown', onFindShortcut, true)
  }, [openSearch])

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    const addon = searchRef.current
    if (!addon) return
    if (!searchTerm) {
      addon.clearDecorations()
      setSearchResult({ resultIndex: 0, resultCount: 0 })
      return
    }
    addon.findNext(searchTerm, { ...searchOptions, incremental: true })
  }, [searchTerm])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    const buffer = sanitizeTerminalBuffer(session.buffer)
    if (buffer === lastBufferRef.current) return
    if (lastBufferRef.current.startsWith(buffer)) return

    if (buffer.startsWith(lastBufferRef.current)) {
      writeTerminal(terminal, buffer.slice(lastBufferRef.current.length), false)
      lastBufferRef.current = buffer
      return
    }

    const sync = diffTerminalBuffer(lastBufferRef.current, buffer)
    lastBufferRef.current = buffer
    if (sync.mode === 'noop') return
    if (sync.mode === 'append') {
      writeTerminal(terminal, sync.chunk, false)
      return
    }

    terminal.reset()
    writeTerminal(terminal, sync.chunk, true)
  }, [session.buffer])

  useEffect(() => {
    const fitAddon = fitRef.current
    const terminal = terminalRef.current
    if (!fitAddon || !terminal) return

    requestAnimationFrame(() => {
      fitAddon.fit()
      terminal.scrollToBottom()
    })
  }, [consoleFullscreen])

  const activeResult = searchResult.resultCount > 0 && searchResult.resultIndex >= 0
    ? searchResult.resultIndex + 1
    : 0

  return (
    <>
      <div className="terminal-surface" ref={containerRef} />
      {searchOpen && (
        <div className="terminal-search" role="search">
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            aria-label="Search console output"
            placeholder="Search console"
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeSearch()
              } else if (event.key === 'Enter') {
                event.preventDefault()
                find(event.shiftKey ? 'previous' : 'next')
              }
            }}
          />
          <span className="terminal-search-count" aria-live="polite">
            {activeResult}/{searchResult.resultCount}
          </span>
          <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" onClick={() => find('previous')}>
            <ChevronUp aria-hidden="true" />
          </button>
          <button type="button" aria-label="Next match" title="Next match (Enter)" onClick={() => find('next')}>
            <ChevronDown aria-hidden="true" />
          </button>
          <button type="button" aria-label="Close search" title="Close search (Escape)" onClick={closeSearch}>
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {copyToastMessage && (
        <div className="console-copy-toast" role="status" aria-live="polite">
          {copyToastMessage}
        </div>
      )}
    </>
  )
}), (prev, next) => prev.session.id === next.session.id && prev.session.buffer === next.session.buffer)
