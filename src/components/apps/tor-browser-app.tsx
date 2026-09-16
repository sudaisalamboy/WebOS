'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Shield, ShieldOff, RefreshCw, Globe, Lock, AlertTriangle, ExternalLink, ChevronRight, Play, Download, Power } from 'lucide-react'
import { cn } from '@/lib/utils'
import { convertYouTubeUrl } from '@/lib/youtube'

interface TorStatus {
  socksOpen: boolean
  controlOpen: boolean
  bootstrap: { percent: number; tag: string; status: string } | null
  ready: boolean
  exitIp: string | null
  socksPort: number
  controlPort: number
}

interface HistoryEntry {
  url: string
  title: string
  ts: number
}

const TOR_HOME = 'tor:home'

// Quick-launch bookmarks — all .onion or privacy-friendly sites
const TOR_BOOKMARKS: { name: string; url: string; emoji: string; desc: string }[] = [
  { name: 'Tor Check', url: 'https://check.torproject.org/api/ip', emoji: '✅', desc: 'Verify Tor connection' },
  { name: 'Tor Project', url: 'https://www.torproject.org/', emoji: '🧅', desc: 'Official Tor site' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com/', emoji: '🦆', desc: 'Privacy search' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/', emoji: '📚', desc: 'Free encyclopedia' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com/', emoji: '📰', desc: 'Tech news' },
  { name: 'ProPublica', url: 'https://www.propublica.org/', emoji: '📰', desc: 'Investigative journalism' },
  { name: 'BBC News', url: 'https://www.bbc.com/news', emoji: '📺', desc: 'World news' },
  { name: 'Reddit', url: 'https://www.reddit.com/', emoji: '👽', desc: 'Social news' },
  { name: 'YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', emoji: '📺', desc: 'Auto-embeds videos' },
]

export function TorBrowserApp() {
  const [status, setStatus] = useState<TorStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [url, setUrl] = useState(TOR_HOME)
  const [inputUrl, setInputUrl] = useState(TOR_HOME)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIdx, setHistoryIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newIdLoading, setNewIdLoading] = useState(false)
  const [newIdMessage, setNewIdMessage] = useState<string | null>(null)
  const [restartLoading, setRestartLoading] = useState(false)
  const [restartMessage, setRestartMessage] = useState<string | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll status endpoint
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tor/status', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch {
      // ignore
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    // Poll every 5s so the user sees live bootstrap progress
    refreshTimerRef.current = setInterval(refreshStatus, 5000)
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [refreshStatus])

  function navigate(to: string) {
    let target = to.trim()
    if (!target) return

    if (target === TOR_HOME) {
      // ok
    } else if (!/^[a-z]+:\/\//i.test(target)) {
      // Looks like a search query if it has spaces
      if (/\s/.test(target) || !target.includes('.')) {
        target = `https://duckduckgo.com/?q=${encodeURIComponent(target)}`
      } else {
        target = `https://${target}`
      }
    }

    // YouTube: convert to embeddable URL (works through Tor without proxy because embed has no X-Frame-Options)
    const ytInfo = convertYouTubeUrl(target)
    if (ytInfo.isYouTube && ytInfo.embeddableUrl) {
      target = ytInfo.embeddableUrl
    }

    const newHistory = [...history.slice(0, historyIdx + 1), { url: target, title: target, ts: Date.now() }]
    setHistory(newHistory)
    setHistoryIdx(newHistory.length - 1)
    setUrl(target)
    setInputUrl(target)
    setError(null)
    setLoading(true)
  }

  function back() {
    if (historyIdx === 0) return
    const newIdx = historyIdx - 1
    setHistoryIdx(newIdx)
    const target = newIdx === 0 ? TOR_HOME : history[newIdx].url
    setUrl(target)
    setInputUrl(target)
    setError(null)
    setLoading(false)
  }

  function forward() {
    if (historyIdx === history.length - 1) return
    const newIdx = historyIdx + 1
    setHistoryIdx(newIdx)
    const target = history[newIdx].url
    setUrl(target)
    setInputUrl(target)
    setError(null)
    setLoading(false)
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') navigate(inputUrl)
  }

  async function newIdentity() {
    setNewIdLoading(true)
    setNewIdMessage(null)
    try {
      const res = await fetch('/api/tor/newid', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setNewIdMessage(data.message)
        // Refresh status after a short delay so exit IP updates
        setTimeout(refreshStatus, 3000)
      } else {
        setNewIdMessage(`Failed: ${data.message}`)
      }
    } catch (err) {
      setNewIdMessage(`Error: ${(err as Error).message}`)
    } finally {
      setNewIdLoading(false)
      // Clear the message after 5s
      setTimeout(() => setNewIdMessage(null), 5000)
    }
  }

  async function restartTor() {
    setRestartLoading(true)
    setRestartMessage(null)
    try {
      const res = await fetch('/api/tor/restart', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setRestartMessage(data.message || 'Tor daemon restarting…')
        // Poll status more aggressively for the next 30s
        const poll = setInterval(refreshStatus, 2000)
        setTimeout(() => clearInterval(poll), 30000)
      } else {
        setRestartMessage(`Failed: ${data.message}`)
      }
    } catch (err) {
      setRestartMessage(`Error: ${(err as Error).message}`)
    } finally {
      setRestartLoading(false)
      setTimeout(() => setRestartMessage(null), 8000)
    }
  }

  function reload() {
    if (url === TOR_HOME) return
    setLoading(true)
    setError(null)
    // Force iframe reload by toggling src
    setUrl((u) => u + '#reload=' + Date.now())
  }

  const isHome = url === TOR_HOME
  const ready = status?.ready ?? false
  const bootstrapPct = status?.bootstrap?.percent ?? 0

  // Compute iframe src:
  //   - home → srcDoc
  //   - YouTube embed URL → load directly (no proxy needed, embed has no X-Frame-Options)
  //   - everything else → /api/tor/proxy?url=...
  const isYouTubeEmbed = url.startsWith('https://www.youtube.com/embed/')
  const proxySrc = !isHome && url
    ? isYouTubeEmbed
      ? url
      : `/api/tor/proxy?url=${encodeURIComponent(url.split('#')[0])}`
    : null

  const homeHtml = `
    <!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 50px 24px; font-family: -apple-system, system-ui, sans-serif;
        background: radial-gradient(ellipse at top, #1a0f2e 0%, #0a0612 100%);
        color: #e2e8f0; min-height: 100vh;
      }
      .logo { text-align: center; margin-bottom: 8px; }
      .logo .onion { font-size: 64px; }
      h1 { font-size: 36px; font-weight: 700; text-align: center; margin: 0 0 8px; color: #a78bfa; }
      .sub { text-align: center; color: #94a3b8; margin-bottom: 32px; font-size: 14px; }
      .status {
        max-width: 600px; margin: 0 auto 32px; padding: 16px 20px; border-radius: 12px;
        background: ${ready ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)'};
        border: 1px solid ${ready ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'};
        text-align: center;
      }
      .status .dot {
        display: inline-block; width: 8px; height: 8px; border-radius: 50%;
        background: ${ready ? '#10b981' : '#f59e0b'}; margin-right: 8px;
        ${ready ? '' : 'animation: pulse 1.5s infinite;'}
      }
      .status .label { font-weight: 600; color: ${ready ? '#10b981' : '#f59e0b'}; }
      .status .detail { font-size: 12px; color: #94a3b8; margin-top: 4px; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      .search {
        max-width: 600px; margin: 0 auto 32px; display: flex; gap: 8px;
      }
      input {
        flex: 1; padding: 14px 20px; border-radius: 12px; border: 1px solid #3f3f5f;
        background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 16px; outline: none;
      }
      input:focus { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.15); }
      button {
        padding: 14px 22px; border-radius: 12px; border: none; cursor: pointer;
        background: linear-gradient(135deg, #a78bfa, #8b5cf6); color: white; font-weight: 600; font-size: 14px;
      }
      .bookmarks-title { text-align: center; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
      .bookmarks {
        max-width: 800px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px;
      }
      .bm {
        display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 12px;
        background: rgba(255,255,255,0.04); border: 1px solid #3f3f5f; border-radius: 12px;
        cursor: pointer; color: #e2e8f0; transition: all 0.15s;
      }
      .bm:hover { background: rgba(167, 139, 250, 0.1); border-color: #a78bfa; transform: translateY(-2px); }
      .bm .ico { font-size: 28px; }
      .bm .lbl { font-size: 13px; font-weight: 600; }
      .bm .desc { font-size: 11px; color: #94a3b8; text-align: center; }
      .note {
        max-width: 800px; margin: 32px auto 0; padding: 14px 18px; border-radius: 10px;
        background: rgba(167, 139, 250, 0.06); border: 1px solid rgba(167, 139, 250, 0.2);
        color: #c4b5fd; font-size: 12px; line-height: 1.5;
      }
      .progress {
        max-width: 600px; margin: 0 auto 24px; height: 6px; border-radius: 3px;
        background: rgba(255,255,255,0.06); overflow: hidden;
      }
      .progress .bar {
        height: 100%; background: linear-gradient(90deg, #a78bfa, #10b981);
        width: ${bootstrapPct}%; transition: width 0.5s;
      }
    </style></head>
    <body>
      <div class="logo"><div class="onion">🧅</div></div>
      <h1>Tor Browser</h1>
      <div class="sub">Anonymous browsing through the Tor network</div>

      <div class="progress"><div class="bar"></div></div>
      <div class="status">
        <span class="dot"></span>
        <span class="label">${ready ? 'Connected to Tor' : statusLoading ? 'Checking status…' : 'Connecting to Tor network…'}</span>
        <div class="detail">
          ${ready && status?.exitIp
            ? `Exit IP: <code style="color:#10b981">${status.exitIp}</code> · SOCKS5 on :${status?.socksPort}`
            : status?.bootstrap
            ? `Bootstrap ${status.bootstrap.percent}% — ${status.bootstrap.status}`
            : 'Waiting for daemon…'}
        </div>
      </div>

      <div class="search">
        <input id="q" placeholder="Search DuckDuckGo or type a URL (incl. .onion)" autofocus
               onkeydown="if(event.key==='Enter'){window.parent.postMessage({type:'tor-nav', url:document.getElementById('q').value},'*');}"
               ${!ready ? 'disabled' : ''}/>
        <button onclick="window.parent.postMessage({type:'tor-nav', url:document.getElementById('q').value},'*')" ${!ready ? 'disabled' : ''}>Go</button>
      </div>

      <div class="bookmarks-title">Quick Launch</div>
      <div class="bookmarks">
        ${TOR_BOOKMARKS.map((b) => `
          <a class="bm" onclick="window.parent.postMessage({type:'tor-nav', url:'${b.url}'},'*');return false;" href="#">
            <div class="ico">${b.emoji}</div>
            <div class="lbl">${b.name}</div>
            <div class="desc">${b.desc}</div>
          </a>`).join('')}
      </div>

      <div class="note">
        <strong>🧅 How Tor Browser works here:</strong> All requests route through the Tor SOCKS5 proxy
        on <code>127.0.0.1:9050</code> via a Next.js API route. .onion sites work too. Sites that block
        Tor exits (some banks, Google) may show errors. Use <strong>"New Identity"</strong> to switch exit
        nodes and get a fresh IP.
      </div>

      <div style="max-width:800px;margin:24px auto 0;padding:20px;border-radius:12px;background:linear-gradient(135deg,rgba(167,139,250,0.1),rgba(139,92,246,0.05));border:1px solid rgba(167,139,250,0.3);">
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-size:32px;margin-bottom:6px;">📦</div>
          <h3 style="margin:0 0 4px;font-size:18px;color:#a78bfa;">Download Real Tor Browser</h3>
          <p style="margin:0;font-size:12px;color:#94a3b8;">Official Tor Browser Bundle 15.0.16 (Linux x86_64, 132 MB)</p>
        </div>
        <a href="/api/tor/download" download="tor-browser-linux-x86_64-15.0.16.tar.xz"
           style="display:flex;align-items:center;justify-content:center;gap:10px;margin:14px auto;padding:14px 24px;max-width:340px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#a78bfa);color:white;font-weight:600;text-decoration:none;font-size:15px;transition:transform 0.15s;">
          ⬇ Download Tor Browser (132 MB)
        </a>
        <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.5;">
          After download: extract with <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;color:#c4b5fd;">tar xf tor-browser-linux-x86_64-15.0.16.tar.xz</code><br>
          then run <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;color:#c4b5fd;">./tor-browser/start-tor-browser.desktop</code> on your own machine.
        </p>
      </div>
    </body></html>
  `

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data && e.data.type === 'tor-nav' && typeof e.data.url === 'string') {
        navigate(e.data.url)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [history, historyIdx])

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-violet-500/30 bg-zinc-900">
        <button onClick={back} disabled={historyIdx === 0} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-violet-500/15 disabled:opacity-30 disabled:cursor-not-allowed text-violet-300">
          <ChevronRight className="h-4 w-4 rotate-180" />
        </button>
        <button onClick={forward} disabled={historyIdx === history.length - 1} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-violet-500/15 disabled:opacity-30 disabled:cursor-not-allowed text-violet-300">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button onClick={reload} disabled={isHome} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-violet-500/15 disabled:opacity-30 disabled:cursor-not-allowed text-violet-300">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>

        {/* Connection status indicator */}
        <div className={cn(
          'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium',
          ready
            ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
            : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
        )}>
          {ready ? <Shield className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">
            {ready ? (status?.exitIp ?? 'Connected') : `${bootstrapPct}%`}
          </span>
        </div>

        {/* URL bar */}
        <div className={cn(
          'flex flex-1 items-center gap-2 mx-1 rounded-full border bg-zinc-950 px-3 py-1.5',
          ready ? 'border-violet-500/40 focus-within:border-violet-500' : 'border-zinc-700 opacity-60'
        )}>
          <Lock className="h-3 w-3 text-violet-400 shrink-0" />
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={onInputKeyDown}
            onFocus={(e) => e.target.select()}
            disabled={!ready}
            placeholder={ready ? 'Search DuckDuckGo or type a URL (incl. .onion)' : 'Waiting for Tor to connect…'}
            className="flex-1 bg-transparent text-sm outline-none text-zinc-100 placeholder:text-zinc-500 min-w-0"
          />
          {loading && <div className="h-3 w-3 rounded-full border-2 border-violet-500 border-t-transparent animate-spin shrink-0" />}
        </div>

        {/* New Identity button */}
        <button
          onClick={newIdentity}
          disabled={!ready || newIdLoading}
          title="Get a new exit node / IP"
          className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', newIdLoading && 'animate-spin')} />
          <span className="hidden sm:inline">New Identity</span>
        </button>

        {/* Download bundle button */}
        <a
          href="/api/tor/download"
          download="tor-browser-linux-x86_64-15.0.16.tar.xz"
          title="Download official Tor Browser Bundle (132 MB tar.xz)"
          className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Download</span>
        </a>
      </div>

      {/* New identity message */}
      {newIdMessage && (
        <div className="px-3 py-1.5 bg-violet-500/15 text-violet-200 text-xs border-b border-violet-500/20 flex items-center gap-2">
          <RefreshCw className="h-3 w-3 shrink-0" />
          <span>{newIdMessage}</span>
        </div>
      )}

      {/* Bookmarks bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-900/50 overflow-x-auto">
        {TOR_BOOKMARKS.map((b) => (
          <button
            key={b.url}
            onClick={() => navigate(b.url)}
            disabled={!ready}
            className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-violet-500/15 transition shrink-0 disabled:opacity-40 text-zinc-300"
          >
            <span>{b.emoji}</span>
            <span className="truncate max-w-32">{b.name}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-white" style={{ overflow: 'auto', pointerEvents: 'auto' }}>
        {!ready ? (
          <ConnectingView
            status={status}
            loading={statusLoading}
            onRestart={restartTor}
            restartLoading={restartLoading}
            restartMessage={restartMessage}
          />
        ) : isHome ? (
          <iframe
            srcDoc={homeHtml}
            title="Tor Home"
            className="h-full w-full border-0"
            style={{ overflow: 'auto', overscrollBehavior: 'contain', pointerEvents: 'auto' }}
            scrolling="yes"
            tabIndex={0}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        ) : error ? (
          <ErrorView url={url} error={error} onRetry={reload} />
        ) : (
          <iframe
            key={proxySrc}
            src={proxySrc ?? ''}
            title="Tor Browser"
            className="h-full w-full border-0"
            style={{ overflow: 'auto', overscrollBehavior: 'contain', pointerEvents: 'auto' }}
            scrolling="yes"
            tabIndex={0}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={(e) => {
              setLoading(false)
              // If iframe content is empty/error, we can't detect it (cross-origin),
              // but if onLoad fires we at least know the response came back.
            }}
            onError={() => {
              setLoading(false)
              setError('Failed to load page')
            }}
          />
        )}

        {/* Loading overlay */}
        {loading && ready && !isHome && !error && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-md bg-zinc-900/90 text-violet-200 text-xs px-3 py-1.5 pointer-events-none shadow-lg">
            <div className="h-3 w-3 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            <span>Routing through Tor…</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectingView({
  status,
  loading,
  onRestart,
  restartLoading,
  restartMessage,
}: {
  status: TorStatus | null
  loading: boolean
  onRestart: () => void
  restartLoading: boolean
  restartMessage: string | null
}) {
  const pct = status?.bootstrap?.percent ?? 0
  const daemonDown = !loading && !status?.socksOpen
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-violet-950/40 text-zinc-100 p-6">
      <div className="max-w-md text-center">
        <div className="text-6xl mb-4 animate-pulse">🧅</div>
        <h2 className="text-xl font-semibold mb-2">
          {loading ? 'Connecting to Tor…' : daemonDown ? 'Tor daemon not running' : 'Bootstrapping…'}
        </h2>
        <p className="text-sm text-zinc-400 mb-4">
          {status?.socksOpen
            ? status?.bootstrap
              ? status.bootstrap.status
              : 'Initializing…'
            : 'The Tor SOCKS5 proxy on 127.0.0.1:9050 is not reachable. Use the button below to start the daemon.'}
        </p>
        <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden mb-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-xs text-zinc-500 tabular-nums mb-5">{pct}%</div>

        {(daemonDown || restartMessage) && (
          <div className="space-y-3">
            <button
              onClick={onRestart}
              disabled={restartLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-5 py-2.5 text-sm font-medium transition"
            >
              <Power className={cn('h-4 w-4', restartLoading && 'animate-pulse')} />
              {restartLoading ? 'Restarting…' : daemonDown ? 'Start Tor Daemon' : 'Restart Tor Daemon'}
            </button>
            {restartMessage && (
              <div className="text-xs text-violet-300 bg-violet-500/10 ring-1 ring-violet-500/20 rounded-md px-3 py-2">
                {restartMessage}
              </div>
            )}
            <div className="text-[11px] text-zinc-600 mt-3">
              💡 The daemon was likely stopped by a container reset. Starting it takes ~10-20s.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ErrorView({ url, error, onRetry }: { url: string; error: string; onRetry: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-800 text-zinc-100 p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/30">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Page not loading</h2>
        <p className="text-sm text-zinc-400 mb-2">
          Failed to fetch <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-rose-400 font-mono text-xs break-all">{url}</code>
        </p>
        <p className="text-xs text-zinc-500 mb-5">{error}</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onRetry}
            className="flex items-center justify-center gap-2 mx-auto rounded-lg bg-violet-500 hover:bg-violet-600 text-white px-5 py-2.5 text-sm font-medium transition"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            Open in new tab (non-Tor)
          </a>
        </div>
        <div className="mt-6 pt-4 border-t border-zinc-800 text-[11px] text-zinc-600">
          <p className="mb-1">💡 Common reasons:</p>
          <p>• Site blocks Tor exits (Google, GitHub, many banks)</p>
          <p>• Circuit timed out — try again or use New Identity</p>
          <p>• .onion site is down</p>
        </div>
      </div>
    </div>
  )
}
