import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import http from 'node:http'
import WebSocket from 'ws'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CDP_PORT = 9222

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

async function sendCdp(wsUrl: string, method: string, params: any): Promise<any> {
  const ws = new WebSocket(wsUrl, { origin: 'http://127.0.0.1:9222' })
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

/**
 * POST /api/vnc/eval
 * Body: { expression: string, awaitPromise?: boolean }
 *
 * Evaluates a JavaScript expression in the currently active remote Chrome tab
 * via CDP Runtime.evaluate, returning the value.
 *
 * Used by the lead-generation scraper (scripts/leads/) — easier to drive Chrome
 * through the existing Next.js + ws pipeline than via Python's websocket-client
 * (which has connection stability issues in this environment).
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const wsUrl = await getTabWsUrl()
  if (!wsUrl) {
    return NextResponse.json({ ok: false, error: 'Chrome not running' }, { status: 503 })
  }

  let body: { expression?: string; awaitPromise?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const expression = body.expression ?? ''
  if (!expression) {
    return NextResponse.json({ ok: false, error: 'expression required' }, { status: 400 })
  }
  if (expression.length > 500_000) {
    return NextResponse.json({ ok: false, error: 'expression too large' }, { status: 413 })
  }

  try {
    const result = await sendCdp(wsUrl, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: body.awaitPromise !== false,
      userGesture: true,
    })
    const value = result?.result?.value
    const exc = result?.exceptionDetails
    if (exc) {
      const desc = exc.exception?.description || exc.text || 'unknown exception'
      return NextResponse.json({ ok: false, error: String(desc).slice(0, 500) })
    }
    return NextResponse.json({ ok: true, value })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 })
  }
}

/** GET — quick health probe. */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const wsUrl = await getTabWsUrl()
  return NextResponse.json({ ok: !!wsUrl, cdp: !!wsUrl })
}
