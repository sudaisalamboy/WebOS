import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import http from 'node:http'
import WebSocket from 'ws'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const CDP_PORT = 9222

/** Get the WebSocket debugger URL of the first page-type tab in remote Chrome. */
function getTabWsUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json`, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const tabs = JSON.parse(body)
          const pageTab = tabs.find((t: any) => t.type === 'page')
          resolve(pageTab?.webSocketDebuggerUrl || null)
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

/** Send a single CDP command over WebSocket and wait for the matching response. */
async function sendCdpCommand(wsUrl: string, method: string, params: any): Promise<any> {
  const ws = new WebSocket(wsUrl, { origin: 'http://127.0.0.1:9222' })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { try { ws.close() } catch {}; reject(new Error('CDP timeout')) }, 10000)
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.on('message', (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.id === 1) {
          clearTimeout(timeout); ws.close()
          if (parsed.error) reject(new Error(parsed.error.message))
          else resolve(parsed.result)
        }
      } catch {}
    })
    ws.on('error', () => { clearTimeout(timeout); reject(new Error('WebSocket error')) })
  })
}

/**
 * POST /api/vnc/paste
 * Body: { text: string }
 *
 * Pastes the supplied text into the currently focused element of the remote
 * Chrome browser (URL bar, search box, input field, textarea, contenteditable)
 * via the Chrome DevTools Protocol `Input.insertText` method.
 *
 * This is needed because noVNC's clipboard sync is unreliable — the local
 * clipboard doesn't automatically reach the remote browser. With this endpoint,
 * the WebOS UI can read the local clipboard (navigator.clipboard.readText)
 * and push it into Chrome via CDP, mimicking a real Ctrl+V paste.
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const wsUrl = await getTabWsUrl()
  if (!wsUrl) {
    return NextResponse.json(
      { ok: false, error: 'Chrome is not running (CDP not available on :9222)' },
      { status: 503 }
    )
  }

  let body: { text?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  const text = body.text ?? ''
  if (typeof text !== 'string') {
    return NextResponse.json({ ok: false, error: 'text must be a string' }, { status: 400 })
  }
  if (text.length === 0) {
    return NextResponse.json({ ok: false, error: 'text is empty' }, { status: 400 })
  }
  // Guard against absurd payloads — 1 MB is more than any URL bar / search box can use.
  if (text.length > 1_000_000) {
    return NextResponse.json(
      { ok: false, error: 'text too large (max 1 MB)' },
      { status: 413 }
    )
  }

  try {
    // Input.insertText inserts text into the currently focused editable element,
    // behaving like an IME commit / paste. Works in URL bar, search boxes,
    // textareas, contenteditable, etc.
    await sendCdpCommand(wsUrl, 'Input.insertText', { text })
    return NextResponse.json({
      ok: true,
      length: text.length,
      preview: text.slice(0, 60) + (text.length > 60 ? '…' : ''),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 }
    )
  }
}

/** GET — quick health probe. */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const wsUrl = await getTabWsUrl()
  return NextResponse.json({ ok: !!wsUrl, cdp: !!wsUrl })
}
