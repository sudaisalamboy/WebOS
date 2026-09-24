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

/** Navigate the active tab to a URL. Waits ADAPTIVELY for the page to reach
 *  a loaded state (DOM + network idle) instead of a fixed 1.5s sleep.
 *  Falls back to a timeout if lifecycle events never fire. */
export async function navigate(url: string): Promise<boolean> {
  // Start listening for load events BEFORE navigating.
  const wsUrl = await getActiveTabWsUrl()
  let loaded = false
  let ws: WebSocket | null = null

  if (wsUrl) {
    try {
      ws = new WebSocket(wsUrl, { origin: `http://127.0.0.1:${CDP_PORT}` })
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1000)
        ws!.on('open', () => { clearTimeout(t); resolve() })
        ws!.on('error', () => { clearTimeout(t); resolve() })
      })
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }))
        ws.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString())
            // networkIdle or load event → page is ready
            if (msg.method === 'Page.lifecycleEvent' &&
                (msg.params.name === 'networkIdle' || msg.params.name === 'load')) {
              loaded = true
            }
          } catch {}
        })
      }
    } catch {}
  }

  await sendCdp('Page.navigate', { url })

  // Wait up to 8 seconds for network idle, checking every 200ms.
  // Fall back to 2s minimum if events never fire (e.g. already-loaded page).
  const deadline = Date.now() + 8000
  while (!loaded && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
  // Minimum settle time even if "loaded" fired immediately (JS needs to run).
  if (loaded) await new Promise((r) => setTimeout(r, 500))

  // Cleanup the listener WS
  try { ws?.close() } catch {}

  return true
}

/** Wait for the page to settle after an action (click, etc).
 *  Uses CDP to detect network activity: waits for 500ms of network silence
 *  (no in-flight requests), up to a max of 3 seconds. This replaces the
 *  old hardcoded 600ms sleep which was too short for slow sites and
 *  wasteful for fast sites. */
export async function waitForSettle(maxMs = 3000): Promise<void> {
  const wsUrl = await getActiveTabWsUrl()
  if (!wsUrl) { await new Promise((r) => setTimeout(r, 600)); return }

  return new Promise<void>((resolve) => {
    let silenceTimer: NodeJS.Timeout | null = null
    let maxTimer: NodeJS.Timeout
    let ws: WebSocket

    try {
      ws = new WebSocket(wsUrl, { origin: `http://127.0.0.1:${CDP_PORT}` })
    } catch { resolve(); return }

    const cleanup = () => { try { ws.close() } catch {} }

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }))
      maxTimer = setTimeout(() => { cleanup(); resolve() }, maxMs)
      // Initial silence — if no requests arrive in 500ms, we're settled
      silenceTimer = setTimeout(() => { clearTimeout(maxTimer); cleanup(); resolve() }, 500)
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        // Any network activity resets the silence timer
        if (msg.method === 'Network.requestWillBeSent' || msg.method === 'Network.dataReceived') {
          if (silenceTimer) clearTimeout(silenceTimer)
          silenceTimer = setTimeout(() => { clearTimeout(maxTimer); cleanup(); resolve() }, 500)
        }
      } catch {}
    })

    ws.on('error', () => { clearTimeout(maxTimer); resolve() })
  })
}

/** Upload a file to a file input element matched by CSS selector.
 *  Uses CDP DOM.setFileInputFiles — the proper way to handle file uploads
 *  (browser file picker dialogs can't be controlled via JS).
 *  `filePaths` must be paths accessible to the Chrome process. */
export async function setFileInputFiles(selector: string, filePaths: string[]): Promise<string> {
  try {
    // Get the document root
    const doc = await sendCdp('DOM.getDocument', { depth: 0 })
    const rootId = doc?.root?.nodeId
    if (!rootId) return 'no document root'

    // Query selector to find the file input node
    const q = await sendCdp('DOM.querySelector', { nodeId: rootId, selector })
    if (!q?.nodeId) return `file input not found: ${selector}`

    // Set the files on the input element
    await sendCdp('DOM.setFileInputFiles', { nodeId: q.nodeId, files: filePaths })
    return `uploaded ${filePaths.length} file(s) to ${selector}`
  } catch (err) {
    return `upload error: ${(err as Error).message}`
  }
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
 * Type text into an element at (x, y). Uses the MOST reliable method:
 *   1. clicks the element to focus it
 *   2. clears any existing content via JS (sets value='' + dispatches events)
 *   3. uses CDP `Input.insertText` per-character (handles ALL unicode —
 *      emoji, accented chars, symbols — no keyCode mapping needed)
 *   4. dispatches `input` + `change` events after each insertion so
 *      React/Vue/Svelte state updates correctly.
 *
 * This replaces the old rawKeyDown+char+keyUp approach which broke on
 * special characters (#, $, %, ^, &, *, etc.) because charToCode returned
 * 'Unidentified' for them. insertText handles every character natively.
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
  // 3. type each character via CDP insertText (per-char so input events fire).
  //    insertText inserts at cursor position and handles ALL unicode chars.
  for (const ch of text) {
    await sendCdp('Input.insertText', { text: ch })
    // Dispatch input event per character so React state updates incrementally.
    await evalJs(`(function(){
      var el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        try { el.dispatchEvent(new Event('input', {bubbles:true})); } catch(e) {}
      }
    })()`)
  }
  // 4. final change event so form validation / onChange handlers fire.
  await evalJs(`(function(){
    var el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      try { el.dispatchEvent(new Event('change', {bubbles:true})); } catch(e) {}
    }
  })()`)
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
  // Use the EXACT selector first — NO fallback to search-box selectors.
  // The old fallback (input[name="q"], #search, etc.) was DANGEROUS because
  // on signup forms, if the AI's selector failed, it would silently fill
  // the search box instead of the intended field — causing wrong data entry.
  // Now we try the exact selector, then a tag-swapped fallback (input↔textarea),
  // then report failure clearly so the AI can try a different approach.
  const fillFn = (sel: string) => evalJs(`(function(){
    var el = null;
    try { el = document.querySelector(${JSON.stringify(sel)}); } catch(e) { return 'invalid selector: ' + e.message; }
    if (!el) return null; // not found — caller will try fallback
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') {
      return 'not an input/textarea/select: <' + el.tagName.toLowerCase() + '>';
    }
    try {
      el.focus();
      // Use the native setter to bypass React's synthetic event wrapping.
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      var nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      var nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      if (el.tagName === 'TEXTAREA') nativeTextareaValueSetter.call(el, ${JSON.stringify(text)});
      else if (el.tagName === 'SELECT') nativeSelectValueSetter.call(el, ${JSON.stringify(text)});
      else nativeInputValueSetter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return 'ok ' + (el.id || el.name || el.type);
    } catch(e) { return 'error: ' + e.message; }
  })()`)

  // Try the exact selector first
  let result = await fillFn(selector)
  // result.value is JSON-serialized: "null" if element not found,
  // "\"ok fieldname\"" if successful, "\"error: ...\"" on error.
  if (result.value !== 'null') {
    // Parse the JSON string to get the actual message
    try { return JSON.parse(result.value) } catch { return result.value || 'unknown' }
  }

  // ---- Tag-swap fallback ----
  // If the AI used "input[name=q]" but the element is actually <textarea name="q">,
  // try the tag-swapped version. This is a VERY common mistake because the AI
  // sees a text input visually but can't tell if it's <input> or <textarea>.
  // NOTE: only swap ONE way (input→textarea OR textarea→input), not both,
  // otherwise they cancel out and nothing changes.
  let swappedSelector = selector
  if (/^input\b/.test(selector)) {
    swappedSelector = selector.replace(/^input\b/, 'textarea')
  } else if (/^textarea\b/.test(selector)) {
    swappedSelector = selector.replace(/^textarea\b/, 'input')
  }
  if (swappedSelector !== selector) {
    result = await fillFn(swappedSelector)
    if (result.value !== 'null') {
      try { return JSON.parse(result.value) } catch { return result.value || 'unknown' }
    }
  }

  // Both failed — report clearly
  return `not found: tried ${selector} and ${swappedSelector}`
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
    /** Where this element was found: 'main', 'shadow', 'iframe:<url>' */
    context?: string
  }>
  /** Full visible text content of the page (document.body.innerText), capped
   *  at 30000 chars — increased from 10000 so the LLM sees more of long pages.
   *  This lets the assistant answer "which video has more views" etc. by
   *  reading the actual page text. */
  pageText: string
  formFields: Array<{
    tag: string; type: string; name: string; id: string; placeholder: string; label: string; value: string; required: boolean; selector: string; x: number; y: number;
    /** For <select> elements: the available options (text + value). */
    options?: Array<{ text: string; value: string }>
  }>
  videos: number
  videoDetails: PageVideo[]
  scrollY: number
  scrollHeight: number
  /** If a native dialog (alert/confirm/prompt) was detected, its text.
   *  Populated by the dialog override injected via anti-detect.
   *  If set, the assistant should acknowledge it or report it. */
  dialog?: { type: string; message: string }
}

/**
 * Get a text summary of the active tab: URL, title, and a list of the
 * most prominent interactive elements (buttons, links, inputs, videos)
 * with their viewport coordinates. This gives the LLM grounding beyond
 * the raw screenshot.
 *
 * IMPROVEMENTS over the old version:
 * - PIERCES SHADOW DOM: recursively queries all shadowRoots (Twitter/X,
 *   modern web components, lit-element, stencil are no longer invisible).
 * - TRAVERSES SAME-ORIGIN IFRAMES: queries contentDocument of same-origin
 *   iframes (ads, embeds, payment frames that are same-origin are now visible).
 * - INCREASED LIMITS: 200 elements (was 50), 30k chars of text (was 10k).
 * - COOKIE DISMISS ONLY ONCE: uses a flag so it doesn't click "Accept" on
 *   every single step (which could click dangerous buttons on later steps).
 * - DIALOG DETECTION: reads window.__lastDialog set by the injected override.
 * - SELECT OPTIONS: <select> dropdowns now include their available options.
 * - BETTER SELECTORS: generates a unique CSS path when id/name are absent.
 */
export async function getPageSummary(): Promise<PageSummary> {
  const expr = `
  (function(){
    // ---- Install dialog override (idempotent) ----
    // Override window.alert/confirm/prompt so we can CAPTURE the message
    // instead of the native dialog blocking the page. The override stores
    // the dialog text in window.__lastDialog and auto-resolves.
    if (!window.__dialogOverrideInstalled) {
      window.__lastDialog = null;
      window.__dialogHistory = window.__dialogHistory || [];
      window.alert = function(msg) {
        var text = String(msg);
        window.__lastDialog = { type: 'alert', message: text };
        window.__dialogHistory.push({ type: 'alert', message: text, time: Date.now() });
      };
      window.confirm = function(msg) {
        var text = String(msg);
        window.__lastDialog = { type: 'confirm', message: text };
        window.__dialogHistory.push({ type: 'confirm', message: text, time: Date.now() });
        return true; // auto-accept
      };
      window.prompt = function(msg, def) {
        var text = String(msg);
        window.__lastDialog = { type: 'prompt', message: text };
        window.__dialogHistory.push({ type: 'prompt', message: text, time: Date.now() });
        return def || ''; // auto-fill with default
      };
      window.__dialogOverrideInstalled = true;
    }
    var dialogInfo = window.__lastDialog;
    // Don't clear it yet — the caller will clear it after reading.
    // (So multiple reads in the same step still see it.)

    function rect(r){
      var b = r.getBoundingClientRect();
      return { x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2), w: Math.round(b.width), h: Math.round(b.height) };
    }

    // ---- Generate a unique CSS selector for an element ----
    function uniqueSelector(el) {
      if (el.id) return '#' + el.id;
      var name = el.getAttribute('name');
      if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
      var type = el.getAttribute('type');
      if (type && el.tagName === 'INPUT') return 'input[type="' + type + '"]';
      // Build a path from tag + nth-of-type
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && node !== document.body) {
        var part = node.tagName.toLowerCase();
        var parent = node.parentNode;
        if (parent) {
          var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === node.tagName; });
          if (siblings.length > 1) {
            var idx = siblings.indexOf(node) + 1;
            part += ':nth-of-type(' + idx + ')';
          }
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.length > 4 ? parts.slice(-4).join(' > ') : parts.join(' > ');
    }

    // ---- Collect ALL elements: main DOM + shadow DOM + same-origin iframes ----
    var sels = 'a, button, input, textarea, select, [role=button], [onclick], video, img, .thumb, .video-thumb, .thumb-block, [data-video], [href*=video], [aria-label], summary, details';

    // Recursively collect elements from a root, descending into shadowRoots
    function collectFromRoot(root, context) {
      var results = [];
      if (!root) return results;
      try {
        var els = root.querySelectorAll ? root.querySelectorAll(sels) : [];
        for (var i = 0; i < els.length; i++) {
          var e = els[i];
          e.__ctx = context; // tag with where it was found
          results.push(e);
          // Descend into shadow DOM
          if (e.shadowRoot) {
            var shadowEls = collectFromRoot(e.shadowRoot, context + ':shadow');
            results = results.concat(shadowEls);
          }
          // Descend into same-origin iframes
          if (e.tagName === 'IFRAME') {
            try {
              var iframeDoc = e.contentDocument;
              if (iframeDoc) {
                var iframeEls = collectFromRoot(iframeDoc, context + ':iframe');
                results = results.concat(iframeEls);
              }
            } catch(err) {} // cross-origin → skip
          }
        }
        // Also check root's own shadowRoot (for document.body.host cases)
        if (root.shadowRoot && root.querySelectorAll) {
          // already handled above per-element
        }
      } catch(err) {}
      return results;
    }

    var allEls = collectFromRoot(document, 'main');
    // Deduplicate (an element might be found multiple times via different paths)
    var seen = new Set();
    allEls = allEls.filter(function(e) {
      if (seen.has(e)) return false;
      seen.add(e);
      return true;
    });

    // Filter to visible elements only
    var visibleEls = allEls.filter(function(e) {
      try {
        var r = e.getBoundingClientRect();
        var visible = r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x < window.innerWidth && r.y < window.innerHeight;
        var style = window.getComputedStyle(e);
        return visible && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      } catch(err) { return false; }
    });

    // Take up to 200 elements (was 50 — too many were being missed on long pages)
    var out = visibleEls.slice(0, 200).map(function(e) {
      var r = rect(e.getBoundingClientRect());
      var id = e.id || '';
      var name = e.getAttribute('name') || '';
      var type = e.getAttribute('type') || '';
      var selector = uniqueSelector(e);
      var placeholder = e.getAttribute('placeholder') || '';
      var text = (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('alt') || placeholder || '').trim().slice(0, 80);
      return {
        tag: e.tagName.toLowerCase(),
        text: text,
        x: r.x, y: r.y,
        role: e.getAttribute('role') || '',
        placeholder: placeholder,
        id: id, name: name, type: type, selector: selector,
        context: e.__ctx || 'main',
      };
    });

    // ---- Rich video info ----
    var vids = Array.from(document.querySelectorAll('video')).map(function(v) {
      var r = v.getBoundingClientRect();
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
    }).filter(function(v) { return v.width > 10 && v.height > 10; });

    // ---- Cookie dismiss: ONLY ONCE per page (flag-based) ----
    // The old code dismissed cookies EVERY step, which could click
    // dangerous buttons (OK on a delete confirmation, etc.). Now we
    // only dismiss on the first sighting, then set a flag.
    if (!window.__cookieDismissed) {
      var cookieBtns = document.querySelectorAll('button, a, input[type=button], [role=button]');
      for (var ci = 0; ci < cookieBtns.length; ci++) {
        var cb = cookieBtns[ci];
        var t = (cb.textContent || cb.value || '').toLowerCase().trim();
        // Only dismiss if the button is in a consent/cookie banner context.
        // Check if the button or its ancestor has cookie-related class/id.
        var inBanner = false;
        var node = cb;
        for (var depth = 0; depth < 5 && node; depth++) {
          var cls = (node.className || '').toString().toLowerCase();
          var bid = (node.id || '').toLowerCase();
          if (cls.includes('cookie') || cls.includes('consent') || cls.includes('gdpr') || cls.includes('privacy') || bid.includes('cookie') || bid.includes('consent') || bid.includes('gdpr')) {
            inBanner = true;
            break;
          }
          node = node.parentElement;
        }
        if (inBanner && (t === 'accept' || t === 'accept all' || t === 'agree' || t === 'i agree' || t === 'got it' || t === 'ok' || t === 'allow all' || t === 'accept cookies' || t.includes('accept') || t.includes('agree'))) {
          try { cb.click(); window.__cookieDismissed = true; } catch(e) {}
          break;
        }
      }
    }

    // ---- Page text: increased to 30000 chars ----
    var pageText = (document.body ? document.body.innerText : '').slice(0, 30000);

    // ---- Form fields: collect ALL (visible or not) with options for selects ----
    var fieldEls = collectFromRoot(document, 'main').filter(function(e) {
      return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT';
    });
    var formFields = fieldEls.map(function(e) {
      var r = e.getBoundingClientRect();
      var id = e.id || ''; var name = e.getAttribute('name') || '';
      var type = e.tagName.toLowerCase() === 'select' ? 'select' : (e.getAttribute('type') || 'text');
      var placeholder = e.getAttribute('placeholder') || '';
      var label = e.getAttribute('aria-label') || '';
      if (!label && id) { var lbl = document.querySelector('label[for="' + id + '"]'); if (lbl) label = (lbl.innerText || '').trim(); }
      if (!label) { var lbl2 = e.closest ? e.closest('label') : null; if (lbl2) label = (lbl2.innerText || '').trim(); }
      var selector = uniqueSelector(e);
      var value = ''; try { value = type === 'password' ? (e.value ? '***' : '') : (e.value || '').slice(0, 30); } catch(e2) {}
      // For <select> elements, collect available options
      var options = undefined;
      if (e.tagName === 'SELECT') {
        options = Array.from(e.options).slice(0, 30).map(function(opt) {
          return { text: (opt.textContent || '').trim().slice(0, 50), value: (opt.value || '').slice(0, 50) };
        });
      }
      return {
        tag: e.tagName.toLowerCase(),
        type: type, name: name, id: id,
        placeholder: placeholder,
        label: label.slice(0, 60),
        value: value,
        required: e.hasAttribute('required'),
        selector: selector,
        x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
        options: options,
      };
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
      dialog: dialogInfo,
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
    const summary = JSON.parse(result.value) as PageSummary
    // Clear the dialog flag after reading so the next step doesn't re-report it
    if (summary.dialog) {
      await evalJs(`window.__lastDialog = null;`)
    }
    return summary
  } catch {
    return {
      url: '', title: '(parse error)',
      viewport: { width: 1280, height: 800 },
      interactiveElements: [], pageText: '', formFields: [], videos: 0, videoDetails: [], scrollY: 0, scrollHeight: 0,
    }
  }
}

/** Clear the dialog flag after the assistant has acknowledged it. */
export async function clearDialogFlag(): Promise<void> {
  await evalJs(`window.__lastDialog = null;`)
}
