'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Home, Star, Globe, Lock, X, ExternalLink, AlertTriangle, Search } from 'lucide-react'

interface Bookmark {
  name: string
  url: string
  description: string
  emoji: string
}

// Sites known to ALLOW iframe embedding (no X-Frame-Options: DENY/SAMEORIGIN, no CSP frame-ancestors)
const BOOKMARKS: Bookmark[] = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org', description: 'Free encyclopedia', emoji: '📚' },
  { name: 'Wikibooks', url: 'https://en.wikibooks.org', description: 'Open-content textbooks', emoji: '📗' },
  { name: 'Wiktionary', url: 'https://en.wiktionary.org', description: 'Free dictionary', emoji: '📕' },
  { name: 'Wikiquote', url: 'https://en.wikiquote.org', description: 'Free quote compendium', emoji: '💬' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', description: 'Tech news & discussion', emoji: '📰' },
  { name: 'Lobsters', url: 'https://lobste.rs', description: 'Computing-focused community', emoji: '🦞' },
  { name: 'Internet Archive', url: 'https://archive.org', description: 'Free books, movies, software', emoji: '💾' },
  { name: 'Project Gutenberg', url: 'https://www.gutenberg.org', description: '70k+ free eBooks', emoji: '📖' },
  { name: 'Example.com', url: 'https://example.com', description: 'Test domain', emoji: '🧪' },
]

// Domains known to BLOCK iframe embedding. When user navigates here, we show a friendly fallback
// instead of a blank iframe.
const BLOCKED_DOMAINS = [
  'google.com', 'www.google.com',
  'github.com', 'gist.github.com',
  'twitter.com', 'x.com',
  'facebook.com', 'm.facebook.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com', 'www.youtube.com',
  'reddit.com', 'www.reddit.com',
  'netflix.com',
  'amazon.com', 'www.amazon.com',
  'stackoverflow.com',
  'medium.com',
  'quora.com',
  'pinterest.com',
  'tiktok.com',
  'whatsapp.com',
  'paypal.com',
  'apple.com',
  'microsoft.com',
  'live.com', 'outlook.com',
  'yahoo.com',
  'bing.com',
  'duckduckgo.com',
  'chatgpt.com', 'openai.com', 'chat.z.ai',
  'claude.ai', 'anthropic.com',
  'spotify.com',
  'twitch.tv',
  'developer.mozilla.org', 'developer.mozilla.com',  // MDN now blocks embedding
]

function isLikelyBlocked(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

const HOME_URL = 'about:home'

export function BrowserApp() {
  const [url, setUrl] = useState(HOME_URL)
  const [inputUrl, setInputUrl] = useState(HOME_URL)
  const [history, setHistory] = useState<string[]>([HOME_URL])
  const [historyIdx, setHistoryIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(BOOKMARKS)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function navigate(to: string) {
    let target = to.trim()
    if (!target) return

    if (target === HOME_URL) {
      // ok
    } else if (!/^[a-z]+:\/\//i.test(target) && !target.startsWith('about:')) {
      // Looks like a search query if it has spaces, else assume https://
      if (/\s/.test(target) || !target.includes('.')) {
        // Default to Wikipedia search (which works in iframe)
        target = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(target)}`
      } else {
        target = `https://${target}`
      }
    }

    // Cancel any pending load timer
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current)
      loadTimerRef.current = null
    }

    const newHistory = [...history.slice(0, historyIdx + 1), target]
    setHistory(newHistory)
    setHistoryIdx(newHistory.length - 1)
    setUrl(target)
    setInputUrl(target)
    setBlocked(false)
    setLoadFailed(false)

    // Pre-check against known blocked domains
    if (isLikelyBlocked(target)) {
      setBlocked(true)
      setLoading(false)
      return
    }
    setLoading(true)
  }

  function back() {
    if (historyIdx === 0) return
    const newIdx = historyIdx - 1
    setHistoryIdx(newIdx)
    setUrl(history[newIdx])
    setInputUrl(history[newIdx])
    setBlocked(isLikelyBlocked(history[newIdx]) && history[newIdx] !== HOME_URL)
    setLoadFailed(false)
  }

  function forward() {
    if (historyIdx === history.length - 1) return
    const newIdx = historyIdx + 1
    setHistoryIdx(newIdx)
    setUrl(history[newIdx])
    setInputUrl(history[newIdx])
    setBlocked(isLikelyBlocked(history[newIdx]) && history[newIdx] !== HOME_URL)
    setLoadFailed(false)
  }

  function reload() {
    if (iframeRef.current && !blocked && url !== HOME_URL) {
      const src = iframeRef.current.src
      iframeRef.current.src = 'about:blank'
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = src
      }, 50)
      setLoading(true)
      setLoadFailed(false)
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') navigate(inputUrl)
  }

  function toggleBookmark() {
    if (url === HOME_URL) return
    if (bookmarks.some((b) => b.url === url)) {
      setBookmarks(bookmarks.filter((b) => b.url !== url))
    } else {
      let name = url.replace(/^https?:\/\//, '').split('/')[0]
      setBookmarks([...bookmarks, { name, url, description: 'User bookmark', emoji: '🔖' }])
    }
  }

  function openInNewTab() {
    if (url && url !== HOME_URL) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  // Iframe load handler — detect silent failures (blocked via X-Frame-Options)
  function onIframeLoad() {
    setLoading(false)
    // For cross-origin iframes we can't read contentDocument, but we can set
    // a timer — if onLoad fires too fast (under ~500ms after navigation) and
    // the URL is not our home page, suspect a block. This is heuristic.
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
  }

  // Heuristic failure detection: if loading state persists > 8s, assume site is slow or blocked
  useEffect(() => {
    if (!loading) return
    loadTimerRef.current = setTimeout(() => {
      // Still loading after 8s — could be blocked or just slow. Don't auto-fail,
      // but show a hint. User can choose to "Open in new tab".
      setLoadFailed(true)
    }, 8000)
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
    }
  }, [loading])

  const isHome = url === HOME_URL
  const isBookmarked = bookmarks.some((b) => b.url === url)

  const homeHtml = `
    <!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 40px 24px; font-family: -apple-system, system-ui, sans-serif;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #e2e8f0;
        min-height: 100vh;
      }
      h1 { font-size: 40px; font-weight: 700; text-align: center; margin: 0 0 8px; background: linear-gradient(135deg, #10b981, #0ea5e9); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
      .sub { text-align: center; color: #94a3b8; margin-bottom: 32px; font-size: 14px; }
      .search {
        max-width: 600px; margin: 0 auto 8px; display: flex; gap: 8px;
      }
      input {
        flex: 1; padding: 14px 20px; border-radius: 12px; border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 16px; outline: none;
      }
      input:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
      button {
        padding: 14px 22px; border-radius: 12px; border: none; cursor: pointer;
        background: linear-gradient(135deg, #10b981, #0ea5e9); color: white; font-weight: 600; font-size: 14px;
      }
      .search-hint {
        text-align: center; color: #64748b; font-size: 11px; max-width: 600px; margin: 0 auto 40px;
      }
      .bookmarks-title { text-align: center; color: #94a3b8; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
      .bookmarks {
        max-width: 800px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px;
      }
      .bm {
        display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 18px 12px;
        background: rgba(255,255,255,0.04); border: 1px solid #334155; border-radius: 12px;
        cursor: pointer; text-decoration: none; color: #e2e8f0; transition: all 0.15s;
      }
      .bm:hover { background: rgba(255,255,255,0.08); border-color: #10b981; transform: translateY(-2px); }
      .bm .ico { font-size: 32px; }
      .bm .lbl { font-size: 13px; font-weight: 600; }
      .bm .desc { font-size: 11px; color: #94a3b8; text-align: center; }
      .note {
        max-width: 800px; margin: 32px auto 0; padding: 14px 18px; border-radius: 10px;
        background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2);
        color: #fbbf24; font-size: 12px; line-height: 1.5;
      }
    </style></head>
    <body>
      <h1>🌐 WebOS Browser</h1>
      <div class="sub">Search Wikipedia or visit an embeddable site</div>
      <div class="search">
        <input id="q" placeholder="Search Wikipedia or type a URL" autofocus
               onkeydown="if(event.key==='Enter'){window.parent.postMessage({type:'navigate', url:document.getElementById('q').value},'*');}"/>
        <button onclick="window.parent.postMessage({type:'navigate', url:document.getElementById('q').value},'*')">Go</button>
      </div>
      <div class="search-hint">Tip: Wikipedia search works in-browser. For Google/GitHub/etc, type the URL then click "Open in new tab" in the toolbar.</div>

      <div class="bookmarks-title">Embeddable Sites</div>
      <div class="bookmarks">
        ${BOOKMARKS.map((b) => `
          <a class="bm" onclick="window.parent.postMessage({type:'navigate', url:'${b.url}'},'*');return false;" href="#">
            <div class="ico">${b.emoji}</div>
            <div class="lbl">${b.name}</div>
            <div class="desc">${b.description}</div>
          </a>`).join('')}
      </div>

      <div class="note">
        <strong>⚠ Why some sites don't load:</strong> Sites like Google, GitHub, Twitter, YouTube, Reddit, and Facebook
        send an <code>X-Frame-Options</code> header that prevents them from being embedded in iframes (a security measure
        against clickjacking). For those sites, use the <strong>"Open in new tab"</strong> button in the toolbar —
        it opens the URL in your real browser.
      </div>
    </body></html>
  `

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data && e.data.type === 'navigate' && typeof e.data.url === 'string') {
        navigate(e.data.url)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const isBookmarked_ = isBookmarked
  const targetHost = (() => {
    try { return new URL(url).hostname } catch { return url } 
  })()

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-border/60 bg-muted/30">
        <button onClick={back} disabled={historyIdx === 0} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/10 disabled:opacity-30 disabled:cursor-not-allowed">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button onClick={forward} disabled={historyIdx === history.length - 1} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/10 disabled:opacity-30 disabled:cursor-not-allowed">
          <ArrowRight className="h-4 w-4" />
        </button>
        <button onClick={reload} disabled={isHome || blocked} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/10 disabled:opacity-30 disabled:cursor-not-allowed">
          <RotateCw className="h-4 w-4" />
        </button>
        <button onClick={() => navigate(HOME_URL)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/10">
          <Home className="h-4 w-4" />
        </button>
        <div className={`flex flex-1 items-center gap-2 mx-1 rounded-full border bg-background px-3 py-1.5 ${blocked ? 'border-amber-500/60' : 'border-border/60 focus-within:border-emerald-500/60'}`}>
          {blocked ? <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" /> : <Lock className="h-3 w-3 text-emerald-500 shrink-0" />}
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={onInputKeyDown}
            onFocus={(e) => e.target.select()}
            placeholder="Search Wikipedia or type a URL"
            className="flex-1 bg-transparent text-sm outline-none min-w-0"
          />
          {loading && <div className="h-3 w-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin shrink-0" />}
        </div>
        <button onClick={toggleBookmark} disabled={isHome} className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/10 disabled:opacity-30 ${isBookmarked_ ? 'text-amber-400' : ''}`}>
          <Star className="h-4 w-4" fill={isBookmarked_ ? 'currentColor' : 'none'} />
        </button>
        {!isHome && (
          <button
            onClick={openInNewTab}
            title="Open in new browser tab"
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-foreground/10 transition"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New tab</span>
          </button>
        )}
      </div>

      {/* Bookmarks bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/60 bg-muted/20 overflow-x-auto">
        {bookmarks.map((b) => (
          <button
            key={b.url}
            onClick={() => navigate(b.url)}
            className="flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-foreground/10 transition shrink-0"
          >
            <span>{b.emoji}</span>
            <span className="truncate max-w-32">{b.name}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-white" style={{ overflow: 'auto', pointerEvents: 'auto' }}>
        {isHome ? (
          <iframe
            ref={iframeRef}
            srcDoc={homeHtml}
            title="Browser Home"
            className="h-full w-full border-0"
            style={{ overflow: 'auto', overscrollBehavior: 'contain', pointerEvents: 'auto' }}
            scrolling="yes"
            tabIndex={0}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        ) : blocked ? (
          <BlockedView url={url} host={targetHost} onOpenNewTab={openInNewTab} />
        ) : (
          <>
            <iframe
              ref={iframeRef}
              src={url}
              title="Browser"
              className="h-full w-full border-0"
              style={{ overflow: 'auto', overscrollBehavior: 'contain', pointerEvents: 'auto' }}
              scrolling="yes"
              tabIndex={0}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
              onLoad={onIframeLoad}
              onError={() => { setLoading(false); setLoadFailed(true) }}
            />
            {/* Hint banner that appears for unknown sites that may be blocked */}
            {loading && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-md bg-zinc-900/90 text-zinc-200 text-xs px-3 py-1.5 pointer-events-none shadow-lg">
                <div className="h-3 w-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                <span>Loading {targetHost}…</span>
              </div>
            )}
            {loadFailed && !loading && (
              <div className="absolute bottom-3 right-3 max-w-sm rounded-md bg-amber-500/95 text-amber-950 text-xs px-3 py-2 shadow-lg">
                <div className="font-semibold mb-1">Page not loading?</div>
                <p className="mb-2">{targetHost} may block iframe embedding. Try opening in a new tab.</p>
                <button
                  onClick={openInNewTab}
                  className="flex items-center gap-1.5 rounded bg-amber-950 text-amber-100 px-2 py-1 text-[11px] font-medium hover:bg-amber-900"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open {targetHost} in new tab
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function BlockedView({ url, host, onOpenNewTab }: { url: string; host: string; onOpenNewTab: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-800 text-zinc-100 p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="text-xl font-semibold mb-2">This site can't be embedded</h2>
        <p className="text-sm text-zinc-400 mb-1">
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-amber-400 font-mono text-xs">{host}</code>
          {' '}sends an <code className="font-mono text-xs">X-Frame-Options</code> header that blocks iframe embedding.
        </p>
        <p className="text-xs text-zinc-500 mb-5">
          This is a security feature of the site, not a bug in WebOS. Most major sites
          (Google, GitHub, Twitter, YouTube, Reddit, Facebook, etc.) do this.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onOpenNewTab}
            className="flex items-center justify-center gap-2 mx-auto rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 text-sm font-medium transition"
          >
            <ExternalLink className="h-4 w-4" />
            Open {host} in new tab
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            Or click here to open directly
          </a>
        </div>
        <div className="mt-6 pt-4 border-t border-zinc-800 text-[11px] text-zinc-600">
          <p className="mb-1">💡 Want embeddable alternatives? Try:</p>
          <p>Wikipedia · MDN · Hacker News · lobste.rs · archive.org · Project Gutenberg</p>
        </div>
      </div>
    </div>
  )
}
