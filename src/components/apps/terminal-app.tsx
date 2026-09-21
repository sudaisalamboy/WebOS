'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/lib/utils'
import { Copy, Check, Trash2 } from 'lucide-react'

/**
 * Real terminal backed by a PTY WebSocket.
 *
 * Connects to ws://<host>/?XTransformPort=3003 (the Caddy gateway routes
 * this to the PTY mini-service on port 3003, which spawns a real bash shell
 * in a pseudo-terminal).
 *
 * This is a REAL terminal — vim, nano, top, htop, ssh, etc. all work
 * because we're talking to a real PTY, not a JS command interpreter.
 * All control keys (Insert, Delete, Home, End, PageUp/Down, Ctrl+R,
 * Ctrl+C, Ctrl+Z, Ctrl+[, etc.) are handled by xterm.js and forwarded
 * as raw bytes to the PTY.
 */
export function TerminalApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [copied, setCopied] = useState(false)

  // Copy ALL terminal text (visible + scrollback) to clipboard.
  // Does NOT send any signal to the PTY — running jobs are not killed.
  const copyTerminalText = async () => {
    const term = termRef.current
    if (!term) return
    try {
      // Read all lines from the active buffer (including scrollback)
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (line) {
          lines.push(line.translateToString(true)) // true = trim trailing whitespace
        }
      }
      // Join lines and copy to clipboard
      const text = lines.join('\n').replace(/\n+$/, '\n') // collapse trailing empty lines
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      // Fallback: select all text in terminal and use execCommand
      try {
        term.selectAll()
        // xterm.js doesn't have a direct text extraction, but we can use the textarea
        const ta = containerRef.current?.querySelector('textarea')
        if (ta) {
          ta.focus()
          ta.select()
          document.execCommand('copy')
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } catch {}
    }
  }

  // Clear terminal screen (does NOT kill running jobs — just clears display)
  const clearTerminal = () => {
    const term = termRef.current
    if (!term) return
    term.clear()
    term.focus()
  }

  useEffect(() => {
    if (!containerRef.current) return

    // Create xterm.js terminal
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: false,
      // Critical: enable application cursor mode + modifyOtherKeys so
      // vim/less/etc. receive proper escape sequences for arrow keys.
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    term.writeln('\x1b[1;32mWebOS Terminal\x1b[0m — real bash via PTY')
    term.writeln('\x1b[2mConnecting to shell…\x1b[0m')

    // Connect to the PTY WebSocket via the Caddy gateway.
    // The XTransformPort query param tells Caddy to route to port 3003.
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/?XTransformPort=3003`

    let disposed = false

    function connect() {
      if (disposed) return
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (disposed) return
        setConnected(true)
        setError(null)
        term.writeln('\x1b[1;32m✓ Connected\x1b[0m')
        // Send initial resize so the shell knows our dimensions
        sendResize()
        // Focus the terminal
        term.focus()
      }

      ws.onmessage = (event) => {
        if (disposed) return
        // The PTY service sends raw bytes. WebSocket messages can be
        // strings or Blobs/ArrayBuffers. We handle both.
        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then((buf) => {
            term.write(new Uint8Array(buf))
          })
        } else if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data))
        } else {
          // String — write directly
          term.write(event.data)
        }
      }

      ws.onerror = () => {
        if (disposed) return
        setError('WebSocket connection error')
      }

      ws.onclose = () => {
        if (disposed) return
        setConnected(false)
        term.writeln('\r\n\x1b[33m[Connection closed — reconnecting in 3s…]\x1b[0m')
        // Auto-reconnect
        setTimeout(() => {
          if (!disposed) {
            setReconnectAttempt((n) => n + 1)
            connect()
          }
        }, 3000)
      }
    }

    connect()

    // Pipe terminal input → WebSocket (keyboard → PTY)
    const onDataDisposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data)
      }
    })

    // Track current rows for the resize message
    let rows = term.rows

    function sendResize() {
      if (wsRef.current?.readyState === WebSocket.OPEN && fitRef.current) {
        const dims = fitRef.current.proposeDimensions()
        if (dims) {
          // Send resize as a binary marker: \x00RESIZE:<cols>x<rows>\x00
          // The PTY service detects this marker and calls TIOCSWINSZ.
          const marker = `\x00RESIZE:${dims.cols}x${rows}\x00`
          wsRef.current.send(marker)
        }
      }
    }

    // Handle window resize → tell the PTY to resize
    const onResize = () => {
      if (fitRef.current) {
        fitRef.current.fit()
        rows = term.rows
        sendResize()
      }
    }
    window.addEventListener('resize', onResize)

    // Also resize when the container size changes (e.g., window restored)
    const resizeObserver = new ResizeObserver(() => {
      if (fitRef.current) {
        try {
          fitRef.current.fit()
          rows = term.rows
          sendResize()
        } catch {}
      }
    })
    resizeObserver.observe(containerRef.current)

    // Cleanup
    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      resizeObserver.disconnect()
      onDataDisposable.dispose()
      try { ws.close() } catch {}
      try { term.dispose() } catch {}
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [])

  return (
    <div className="relative flex h-full w-full flex-col bg-zinc-950">
      {/* Status bar */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-1 text-[10px] font-mono border-b shrink-0',
        connected
          ? 'bg-emerald-950/50 border-emerald-800/50 text-emerald-300'
          : 'bg-zinc-900 border-zinc-800 text-zinc-500'
      )}>
        <span className={cn(
          'h-1.5 w-1.5 rounded-full',
          connected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'
        )} />
        {connected ? 'CONNECTED' : 'DISCONNECTED'}
        {error && <span className="text-rose-400 ml-2">{error}</span>}
        {reconnectAttempt > 0 && !connected && (
          <span className="text-amber-400 ml-2">reconnect #{reconnectAttempt}</span>
        )}
        <span className="ml-auto text-zinc-500">bash · vim · nano · all control keys work</span>

        {/* Copy button — copies ALL terminal text (scrollback + visible) to clipboard.
            Does NOT kill running jobs — just reads the buffer. */}
        <button
          onClick={copyTerminalText}
          title="Copy all terminal text to clipboard"
          className={cn(
            'flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold transition',
            copied
              ? 'bg-emerald-500 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>

        {/* Clear button — clears the terminal display (does NOT kill running jobs) */}
        <button
          onClick={clearTerminal}
          title="Clear terminal screen (does not kill running jobs)"
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold transition bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>
      {/* xterm.js container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden p-1"
        onClick={() => termRef.current?.focus()}
      />
    </div>
  )
}
