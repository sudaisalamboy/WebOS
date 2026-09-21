/**
 * Live Browser Session Manager
 * ----------------------------
 * Spawns a persistent headless Chromium per session, configured to route all
 * traffic through the local Tor SOCKS5 proxy (127.0.0.1:9050). The same
 * browser/page stays alive across multiple screenshot + action requests so
 * the user can actually interact with the page (click, scroll, type, navigate).
 *
 * Why this exists:
 *   The old /api/tor/proxy approach fetches HTML and rewrites URLs to route
 *   sub-resources through the proxy. That breaks for any site that:
 *     - sets img.src via JS after load (lazy-loaders, carousels)
 *     - uses srcset (responsive images)
 *     - uses Content-Security-Policy that blocks our injected scripts
 *     - has TLS certs Node's bundled CA doesn't trust
 *   Rendering the actual page in a real browser and streaming screenshots
 *   sidesteps ALL of these issues — what the browser sees, the user sees.
 *
 * Architecture:
 *   - Session = { browser, context, page, createdAt, lastActivity }
 *   - Sessions are kept in a Map keyed by sessionId (random uuid)
 *   - Idle sessions are reaped after 5 min of inactivity (saves RAM)
 *   - Each session = ~150MB RAM (Chromium), so we cap at 8 concurrent sessions
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

export interface LiveSession {
  id: string
  browser: Browser
  context: BrowserContext
  page: Page
  createdAt: number
  lastActivity: number
  currentUrl: string
  ready: boolean
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000  // 5 minutes idle → reap
const MAX_SESSIONS = 8
const SESSION_MAP = new Map<string, LiveSession>()
let reaperStarted = false

const CHROMIUM_EXECUTABLE = '/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'
const TOR_SOCKS = 'socks5://127.0.0.1:9050'

/** Background reaper — kills idle sessions to free RAM. */
function startReaper() {
  if (reaperStarted) return
  reaperStarted = true
  setInterval(async () => {
    const now = Date.now()
    for (const [id, s] of SESSION_MAP.entries()) {
      if (now - s.lastActivity > SESSION_TIMEOUT_MS) {
        try { await s.browser.close() } catch {}
        SESSION_MAP.delete(id)
      }
    }
  }, 60_000).unref()
}

/** Create a new live browser session. */
export async function createSession(initialUrl?: string): Promise<LiveSession> {
  startReaper()

  // Evict oldest if at capacity
  if (SESSION_MAP.size >= MAX_SESSIONS) {
    let oldest: string | null = null
    let oldestTs = Infinity
    for (const [id, s] of SESSION_MAP.entries()) {
      if (s.lastActivity < oldestTs) { oldestTs = s.lastActivity; oldest = id }
    }
    if (oldest) {
      const old = SESSION_MAP.get(oldest)
      if (old) { try { await old.browser.close() } catch {} }
      SESSION_MAP.delete(oldest)
    }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_EXECUTABLE,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      `--proxy-server=${TOR_SOCKS}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions',
      '--disable-plugins',
      '--no-first-run',
      // Allow insecure certs (some .onion sites have self-signed certs)
      '--ignore-certificate-errors',
    ],
  })

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0',
    locale: 'en-US',
    timezoneId: 'UTC',
    // Ignore TLS errors at context level too
    ignoreHTTPSErrors: true,
    // Block ad/tracker domains at the request level (faster page loads)
    // This is a string match — anything containing these substrings is aborted
  })

  // Block ad/tracker requests at the network layer (saves bandwidth on Tor)
  const BLOCK_PATTERNS = [
    'doubleclick.net', 'googlesyndication.com', 'googletagmanager.com',
    'google-analytics.com', 'adservice.google.com',
    'popads.net', 'popcash.net', 'propellerads.com',
    'exoclick.com', 'juicyads.com', 'trafficjunky.com',
    'adsterra.com', 'adultadworld.com',
    'amazon-adsystem.com', 'criteo.com', 'hotjar.com',
    'mixpanel.com', 'segment.io', 'facebook.net',
    'pemsrv.com', 'magsrv.com', 'exosrv.com', 'realsrv.com',
    'mc.yandex.ru', 'counter.yadro.ru',
  ]
  await context.route('**/*', (route) => {
    const url = route.request().url().toLowerCase()
    if (BLOCK_PATTERNS.some(p => url.includes(p))) {
      return route.abort()
    }
    return route.continue()
  })

  const page = await context.newPage()

  const id = generateSessionId()
  const session: LiveSession = {
    id,
    browser,
    context,
    page,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    currentUrl: '',
    ready: false,
  }
  SESSION_MAP.set(id, session)

  // If URL provided, navigate in the background (caller can poll status)
  if (initialUrl) {
    session.ready = false
    navigateSession(id, initialUrl).catch(() => {})
  } else {
    session.ready = true
  }

  return session
}

/** Navigate an existing session to a new URL. */
export async function navigateSession(id: string, url: string): Promise<{ ok: boolean; finalUrl?: string; title?: string; error?: string }> {
  const s = SESSION_MAP.get(id)
  if (!s) return { ok: false, error: 'session not found' }
  s.lastActivity = Date.now()
  s.ready = false

  try {
    // Normalize URL
    let target = url.trim()
    if (!target) return { ok: false, error: 'empty url' }
    if (!/^https?:\/\//i.test(target)) {
      // Has a dot → treat as URL; otherwise DuckDuckGo search
      if (target.includes('.') && !/\s/.test(target)) {
        target = `https://${target}`
      } else {
        target = `https://duckduckgo.com/?q=${encodeURIComponent(target)}`
      }
    }

    await s.page.goto(target, {
      timeout: 30_000,
      waitUntil: 'domcontentloaded',  // don't wait for images — user sees them stream in
    })
    s.currentUrl = s.page.url()
    s.ready = true
    const title = await s.page.title().catch(() => '')
    return { ok: true, finalUrl: s.currentUrl, title }
  } catch (err) {
    s.ready = true  // allow continued interaction even if nav failed
    return { ok: false, error: (err as Error).message }
  }
}

/** Get a session by ID. */
export function getSession(id: string): LiveSession | undefined {
  const s = SESSION_MAP.get(id)
  if (s) s.lastActivity = Date.now()
  return s
}

/** Close + remove a session. */
export async function closeSession(id: string): Promise<void> {
  const s = SESSION_MAP.get(id)
  if (!s) return
  try { await s.browser.close() } catch {}
  SESSION_MAP.delete(id)
}

/** Generate a short random session ID. */
function generateSessionId(): string {
  return 's_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4)
}

/** List active sessions (for status endpoint). */
export function listSessions(): Array<{ id: string; url: string; ready: boolean; idleSec: number }> {
  const now = Date.now()
  return Array.from(SESSION_MAP.values()).map(s => ({
    id: s.id,
    url: s.currentUrl,
    ready: s.ready,
    idleSec: Math.floor((now - s.lastActivity) / 1000),
  }))
}
