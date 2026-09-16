import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import http from 'node:http'
import WebSocket from 'ws'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CDP_PORT = 9222

function getAllTabWsUrls(): Promise<string[]> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json`, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const tabs = JSON.parse(body)
          resolve(tabs.filter((t: any) => t.type === 'page').map((t: any) => t.webSocketDebuggerUrl).filter(Boolean))
        } catch { resolve([]) }
      })
    })
    req.on('error', () => resolve([]))
    req.on('timeout', () => { req.destroy(); resolve([]) })
  })
}

async function sendCdp(wsUrl: string, method: string, params: any): Promise<any> {
  const ws = new WebSocket(wsUrl, { origin: 'http://127.0.0.1:9222' })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { try { ws.close() } catch {}; reject(new Error('timeout')) }, 15000)
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.on('message', (data: Buffer) => {
      try { const d = JSON.parse(data.toString()); if (d.id === 1) { clearTimeout(timeout); ws.close(); resolve(d.result) } } catch {}
    })
    ws.on('error', () => { clearTimeout(timeout); reject(new Error('WS error')) })
  })
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  let perms: string[]
  if (body.permissions && Array.isArray(body.permissions)) perms = body.permissions
  else if (body.permission) perms = [body.permission]
  else perms = ['videoCapture', 'audioCapture']

  perms = perms.map((p: string) => p === 'camera' ? 'videoCapture' : p === 'microphone' ? 'audioCapture' : p)

  const wsUrls = await getAllTabWsUrls()
  if (wsUrls.length === 0) return NextResponse.json({ error: 'Chrome not running' }, { status: 503 })

  let okCount = 0
  for (const wsUrl of wsUrls) {
    try {
      const evalResult = await sendCdp(wsUrl, 'Runtime.evaluate', { expression: 'window.location.origin' })
      const origin = evalResult?.result?.value || '*'
      await sendCdp(wsUrl, 'Browser.grantPermissions', { permissions: perms, origin })
      okCount++
    } catch {}
  }

  return NextResponse.json({ ok: okCount > 0, permissions: perms, tabsGranted: okCount, totalTabs: wsUrls.length })
}

export async function GET() {
  return NextResponse.json({ permissions: ['videoCapture', 'audioCapture'] })
}
