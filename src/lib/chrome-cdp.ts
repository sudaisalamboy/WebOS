/**
 * Chrome DevTools Protocol (CDP) helper library.
 *
 * All functions talk to the local Chrome instance running on the remote
 * Xvfb display, exposed via --remote-debugging-port=9222. This is the SAME
 * Chrome that the noVNC viewer (Remote Chrome app) shows — so the AI
 * assistant sees exactly what the user sees in the VNC window.
 *
 * Used by the AI Assistant backend (src/app/api/assistant/chat/route.ts)
 * to drive Chrome: take screenshots, click, type, scroll, run JS, etc.
 */
import http from 'node:http'
import WebSocket from 'ws'

const CDP_PORT = 9222

export interface ChromeTab {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl: string | null
}

/** List all open Chrome tabs (type === 'page'). */
export function getTabs(): Promise<ChromeTab[]> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json`, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const tabs = JSON.parse(body) as ChromeTab[]
          resolve(tabs.filter((t) => t.type === 'page'))
        } catch {
          resolve([])
        }
      })
    })
    req.on('error', () => resolve([]))
    req.on('timeout', () => { req.destroy(); resolve([]) })
  })
}

/** Close a Chrome tab by its target id. */
export function closeTab(targetId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/close/${targetId}`, { timeout: 3000 }, (res) => {
      res.on('data', () => {})
      res.on('end', () => resolve(true))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

/** Create a new Chrome tab at the given URL. Returns the new tab. */
export function newTab(url: string): Promise<ChromeTab | null> {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(url)
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/new?${encoded}`, { timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try { resolve(JSON.parse(body) as ChromeTab) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

/** Get the first (active) page tab's WS debugger URL. */
async function getActiveTabWsUrl(): Promise<string | null> {
  const tabs = await getTabs()
  return tabs[0]?.webSocketDebuggerUrl ?? null
}

/**
 * Send a single CDP command to the active tab and await its result.
 * Opens a fresh WS connection per call (simple, avoids multi-call state).
 */
async function sendCdp(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const wsUrl = await getActiveTabWsUrl()
  if (!wsUrl) throw new Error('Chrome not running (no CDP tab)')
  const ws = new WebSocket(wsUrl, { origin: `http://127.0.0.1:${CDP_PORT}` })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { try { ws.close() } catch {}; reject(new Error('CDP timeout')) }, 40000)
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.on('message', (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.id === 1) {
          clearTimeout(timeout); ws.close()
          if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)))
          else resolve(parsed.result)
        }
      } catch {}
    })
    ws.on('error', () => { clearTimeout(timeout); reject(new Error('WebSocket error')) })
  })
}

/** Capture a screenshot of the active tab as a base64 PNG string. */
export async function screenshot(): Promise<string> {
  const result = await sendCdp('Page.captureScreenshot', { format: 'png' })
  return result?.data ?? ''
}

/** Navigate the active tab to a URL. */
export async function navigate(url: string): Promise<boolean> {
  await sendCdp('Page.navigate', { url })
  // give the page a moment to load
  await new Promise((r) => setTimeout(r, 1500))
  return true
}

/** Click at (x, y) in viewport coordinates. */
export async function click(x: number, y: number): Promise<void> {
  const common = { x, y, button: 'left', clickCount: 1 }
  await sendCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...common, button: 'none' })
  await sendCdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...common })
  await sendCdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common })
}

/** Scroll the page by deltaY pixels at (x, y). Positive = down. */
export async function scroll(x: number, y: number, deltaY: number): Promise<void> {
  await sendCdp('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y,
    deltaX: 0, deltaY,
    button: 'none',
  })
}

/** Type text into the currently focused element. */
export async function typeText(text: string): Promise<void> {
  await sendCdp('Input.insertText', { text })
}

/**
 * Type text into an element at (x, y) using REAL per-character key events.
 * This is what signup/login forms need — `Input.insertText` replaces the
 * whole field and bypasses React's onChange / input event listeners, so
 * many modern forms don't register the typed value. This version:
 *   1. clicks the element to focus it
 *   2. clears any existing content (Ctrl+A + Backspace)
 *   3. dispatches keyDown + char events per character so input/change events
 *      fire normally and React state updates.
 */
export async function typeInto(x: number, y: number, text: string): Promise<void> {
  // 1. focus the element — click, then wait for the focus event to settle.
  await click(x, y)
  await new Promise((r) => setTimeout(r, 150))
  // 2. clear existing content via JS on document.activeElement (the focused one).
  await evalJs(`(function(){
    var el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      try { el.value = ''; } catch(e) {}
      try { el.select(); document.execCommand('delete'); } catch(e) {}
      try { el.dispatchEvent(new Event('input', {bubbles:true})); } catch(e) {}
      return 'cleared ' + el.id;
    }
    return 'no input focused (active=' + (el ? el.tagName : 'none') + ')';
  })()`)
  await new Promise((r) => setTimeout(r, 80))
  // 3. type each character as a real key event (fires input/change).
  for (const ch of text) {
    const code = charToCode(ch)
    const keyCode = charToKeyCode(ch)
    await sendCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ch, code, windowsVirtualKeyCode: keyCode, modifiers: 0 })
    await sendCdp('Input.dispatchKeyEvent', { type: 'char', key: ch, code, windowsVirtualKeyCode: keyCode, text: ch, modifiers: 0 })
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: keyCode, modifiers: 0 })
  }
}

/**
 * Fill a form field matched by CSS selector using JS value-setting +
 * event dispatch. This is the MOST reliable way to fill React/Vue forms
 * because it doesn't depend on click-coordinate accuracy (the LLM's
 * screenshot coordinates are often offset by the browser-chrome height).
 * Sets .value, then dispatches input + change events so the framework's
 * state updates.
 */
export async function fillBySelector(selector: string, text: string): Promise<string> {
  const result = await evalJs(`(function(){
    // Try the given selector first, then fall back to common search box selectors
    var selectors = [
      ${JSON.stringify(selector)},
      'input[name="q"]',
      'input[type="search"]',
      'input[placeholder*="Search" i]',
      'input[placeholder*="search" i]',
      'input[type="text"]',
      '#search',
      '#searchbox',
      '.search-input',
      'input'
    ];
    var el = null;
    for (var i = 0; i < selectors.length; i++) {
      try { el = document.querySelector(selectors[i]); } catch(e) {}
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) break;
      el = null;
    }
    if (!el) return 'not found: tried ' + selectors.join(', ');
    try {
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return 'ok ' + (el.id || el.name || el.type);
    } catch(e) { return 'error: ' + e.message; }
  })()`)
  return result.value || result.error || 'unknown'
}

/** Map a printable character to its DOM KeyboardEvent.code (e.g. 'a' -> 'KeyA', '1' -> 'Digit1'). */
function charToCode(ch: string): string {
  if (/^[a-zA-Z]$/.test(ch)) return 'Key' + ch.toUpperCase()
  if (/^[0-9]$/.test(ch)) return 'Digit' + ch
  if (ch === ' ') return 'Space'
  if (ch === '.') return 'Period'
  if (ch === '@') return 'Digit2'  // shift+2 on US layout
  if (ch === '-') return 'Minus'
  if (ch === '_') return 'Minus'
  if (ch === '/') return 'Slash'
  return 'Unidentified'
}

/** Map a printable character to its windows virtual key code. */
function charToKeyCode(ch: string): number {
  if (/^[a-zA-Z]$/.test(ch)) return 65 + ch.toUpperCase().charCodeAt(0) - 65  // A=65..
  if (/^[0-9]$/.test(ch)) return 48 + ch.charCodeAt(0) - 48  // 0=48..
  if (ch === ' ') return 32
  if (ch === '.') return 190
  if (ch === '@') return 50  // '2' key, shift produces '@'
  if (ch === '-') return 189
  if (ch === '_') return 189
  if (ch === '/') return 191
  if (ch === '\n' || ch === '\r') return 13
  return 0
}

/**
 * Press a key. `key` should be a key name like 'Enter', 'Tab', 'Escape',
 * 'F12', 'Space', 'Backspace', 'ArrowDown', etc. (CDP key codes are
 * derived from the KeyIdentifier spec.)
 */
export async function pressKey(key: string): Promise<void> {
  const { keyText, code, keyCode, keyIdentifier } = mapKey(key)
  const common = {
    type: 'keyDown',
    windowsVirtualKeyCode: keyCode,
    code,
    key: keyText,
    text: keyText.length === 1 ? keyText : undefined,
  }
  // F-keys and modifiers don't produce text
  await sendCdp('Input.dispatchKeyEvent', { ...common, keyIdentifier } as any)
  await sendCdp('Input.dispatchKeyEvent', { ...common, type: 'keyUp', keyIdentifier } as any)
}

function mapKey(key: string): { keyText: string; code: string; keyCode: number; keyIdentifier: string } {
  const map: Record<string, { keyText: string; code: string; keyCode: number; keyIdentifier: string }> = {
    Enter: { keyText: 'Enter', code: 'Enter', keyCode: 13, keyIdentifier: 'U+000D' },
    Tab: { keyText: 'Tab', code: 'Tab', keyCode: 9, keyIdentifier: 'U+0009' },
    Escape: { keyText: 'Escape', code: 'Escape', keyCode: 27, keyIdentifier: 'U+001B' },
    Backspace: { keyText: 'Backspace', code: 'Backspace', keyCode: 8, keyIdentifier: 'U+0008' },
    Space: { keyText: ' ', code: 'Space', keyCode: 32, keyIdentifier: 'U+0020' },
    F12: { keyText: 'F12', code: 'F12', keyCode: 123, keyIdentifier: 'U+007B' },
    F5: { keyText: 'F5', code: 'F5', keyCode: 116, keyIdentifier: 'U+0074' },
    ArrowUp: { keyText: 'ArrowUp', code: 'ArrowUp', keyCode: 38, keyIdentifier: 'Up' },
    ArrowDown: { keyText: 'ArrowDown', code: 'ArrowDown', keyCode: 40, keyIdentifier: 'Down' },
    ArrowLeft: { keyText: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, keyIdentifier: 'Left' },
    ArrowRight: { keyText: 'ArrowRight', code: 'ArrowRight', keyCode: 39, keyIdentifier: 'Right' },
  }
  return map[key] ?? { keyText: key, code: key, keyCode: 0, keyIdentifier: '' }
}

/**
 * Evaluate a JavaScript expression in the page context. This is the
 * "console" — the assistant uses it to run DOM queries, play/pause videos,
 * read page state, etc. Returns the value (JSON-serialized).
 */
export async function evalJs(expression: string): Promise<{ value: string; error?: string }> {
  try {
    const result = await sendCdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (result?.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'unknown'
      return { value: '', error: String(desc).slice(0, 500) }
    }
    return { value: JSON.stringify(result?.result?.value ?? null) }
  } catch (err) {
    return { value: '', error: (err as Error).message }
  }
}

export interface PageVideo {
  /** Centered viewport coordinates (x, y) and size. */
  x: number
  y: number
  width: number
  height: number
  /** Is the video currently playing? */
  playing: boolean
  /** Current time / duration in seconds, if available. */
  currentTime: number
  duration: number
  /** Whether the video has a visible play button overlay (likely needs a click to start). */
  paused: boolean
  /** Source URL of the video, if any. */
  src: string
  /** Whether the <video> element itself is the click target, or a play-button overlay covers it. */
  hasControls: boolean
}

export interface PageSummary {
  url: string
  title: string
  viewport: { width: number; height: number }
  interactiveElements: Array<{
    tag: string
    text: string
    x: number
    y: number
    role: string
    placeholder?: string
    id?: string
    name?: string
    type?: string
    selector?: string
  }>
  /** Full visible text content of the page (document.body.innerText), capped
   *  at 3000 chars so the LLM can read EVERYTHING the user sees — not just
   *  the 25 interactive elements. This lets the assistant answer "which
   *  video has more views" etc. by reading the actual page text. */
  pageText: string
  formFields: Array<{
    tag: string; type: string; name: string; id: string; placeholder: string; label: string; value: string; required: boolean; selector: string; x: number; y: number
  }>
  videos: number
  videoDetails: PageVideo[]
  scrollY: number
  scrollHeight: number
}

/**
 * Get a text summary of the active tab: URL, title, and a list of the
 * most prominent interactive elements (buttons, links, inputs, videos)
 * with their viewport coordinates. This gives the LLM grounding beyond
 * the raw screenshot.
 */
export async function getPageSummary(): Promise<PageSummary> {
  const expr = `
  (function(){
    function rect(r){
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2), w: Math.round(b.width), h: Math.round(b.height) };
    }
    const sels = 'a, button, input, textarea, select, [role=button], [onclick], video';
    const els = Array.from(document.querySelectorAll(sels)).filter(e=>{
      const r = e.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x < window.innerWidth && r.y < window.innerHeight;
      const style = window.getComputedStyle(e);
      return visible && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    });
    const out = els.slice(0, 30).map(e=>{
      const r = rect(e.getBoundingClientRect());
      const id = e.id || '';
      const name = e.getAttribute('name') || '';
      const type = e.getAttribute('type') || '';
      let selector = '';
      if (id) selector = '#' + id;
      else if (name) selector = e.tagName.toLowerCase() + '[name="' + name + '"]';
      else if (type) selector = e.tagName.toLowerCase() + '[type="' + type + '"]';
      const placeholder = e.getAttribute('placeholder') || '';
      const text = (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('alt') || placeholder || '').trim().slice(0, 60);
      return {
        tag: e.tagName.toLowerCase(),
        text: text,
        x: r.x, y: r.y,
        role: e.getAttribute('role') || '',
        placeholder: placeholder,
        id, name, type, selector,
      };
    });
    // Rich video info: where are the videos, are they playing, what's their source?
    const vids = Array.from(document.querySelectorAll('video')).map(v=>{
      const r = v.getBoundingClientRect();
      return {
        x: Math.round(r.x + r.width/2),
        y: Math.round(r.y + r.height/2),
        width: Math.round(r.width),
        height: Math.round(r.height),
        playing: !v.paused && !v.ended,
        paused: v.paused,
        currentTime: Math.round((v.currentTime || 0) * 10) / 10,
        duration: Math.round((v.duration || 0) * 10) / 10,
        src: (v.currentSrc || v.src || '').slice(0, 120),
        hasControls: v.controls === true,
      };
    }).filter(v => v.width > 10 && v.height > 10);
    // Full visible text of the page — the assistant reads this to answer
    // questions like "which video has more views" by reading the actual page.
    var pageText = (document.body ? document.body.innerText : '').slice(0, 8000);
    // Collect ALL form fields (input/textarea/select) with coordinates + selectors
    var fieldEls = Array.from(document.querySelectorAll('input, textarea, select'));
    var formFields = fieldEls.map(e => {
      var r = e.getBoundingClientRect();
      var id = e.id || ''; var name = e.getAttribute('name') || '';
      var type = e.tagName.toLowerCase() === 'select' ? 'select' : (e.getAttribute('type') || 'text');
      var placeholder = e.getAttribute('placeholder') || '';
      var label = e.getAttribute('aria-label') || '';
      if (!label && id) { var lbl = document.querySelector('label[for="' + id + '"]'); if (lbl) label = (lbl.innerText || '').trim(); }
      if (!label) { var lbl2 = e.closest('label'); if (lbl2) label = (lbl2.innerText || '').trim(); }
      var selector = id ? '#' + id : (name ? e.tagName.toLowerCase() + '[name="' + name + '"]' : e.tagName.toLowerCase() + '[type="' + type + '"]');
      var value = ''; try { value = type === 'password' ? (e.value ? '***' : '') : (e.value || '').slice(0, 30); } catch(e2) {}
      return { tag: e.tagName.toLowerCase(), type, name, id, placeholder, label: label.slice(0, 60), value, required: e.hasAttribute('required'), selector, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    });
    return {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      interactiveElements: out,
      pageText: pageText,
      formFields: formFields,
      videos: document.querySelectorAll('video').length,
      videoDetails: vids,
      scrollY: Math.round(window.scrollY),
      scrollHeight: Math.round(document.documentElement.scrollHeight),
    };
  })()
  `
  const result = await evalJs(expr)
  if (result.error) {
    return {
      url: '', title: '(unable to read page)',
      viewport: { width: 1280, height: 800 },
      interactiveElements: [], pageText: '', formFields: [], videos: 0, videoDetails: [], scrollY: 0, scrollHeight: 0,
    }
  }
  try {
    return JSON.parse(result.value) as PageSummary
  } catch {
    return {
      url: '', title: '(parse error)',
      viewport: { width: 1280, height: 800 },
      interactiveElements: [], pageText: '', formFields: [], videos: 0, videoDetails: [], scrollY: 0, scrollHeight: 0,
    }
  }
}
