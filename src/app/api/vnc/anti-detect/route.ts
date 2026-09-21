import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import http from 'node:http'
import WebSocket from 'ws'
import { ANTI_DETECT_JS } from '@/lib/anti-detect'
import { AUTO_ALLOW_JS } from '@/lib/auto-allow'

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
        try { resolve(JSON.parse(body).filter((t: any) => t.type === 'page').map((t: any) => t.webSocketDebuggerUrl).filter(Boolean)) }
        catch { resolve([]) }
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
    ws.on('message', (data: Buffer) => { try { const d = JSON.parse(data.toString()); if (d.id === 1) { clearTimeout(timeout); ws.close(); resolve(d.result) } } catch {} })
    ws.on('error', () => { clearTimeout(timeout); reject(new Error('WS error')) })
  })
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const wsUrls = await getAllTabWsUrls()
  if (wsUrls.length === 0) return NextResponse.json({ error: 'Chrome not running' }, { status: 503 })

  let okCount = 0
  for (const wsUrl of wsUrls) {
    try {
      await sendCdp(wsUrl, 'Page.enable', {}).catch(() => {})
      // NETWORK-LEVEL UA + Client Hints override — this is the key fix for
      // Cloudflare Turnstile. Set at the Network domain so even the HTTP
      // request headers (Sec-CH-UA, User-Agent) match a normal Chrome 151.
      // The JS-level anti-detect alone isn't enough because Cloudflare reads
      // the headers before the page's JS runs.
      await sendCdp(wsUrl, 'Network.enable', {}).catch(() => {})
      await sendCdp(wsUrl, 'Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        platform: 'Linux x86_64',
        userAgentMetadata: {
          brands: [
            { brand: 'Google Chrome', version: '151' },
            { brand: 'Chromium', version: '151' },
            { brand: 'Not_A Brand', version: '24' },
          ],
          fullVersionList: [
            { brand: 'Google Chrome', version: '151.0.0.0' },
            { brand: 'Chromium', version: '151.0.0.0' },
            { brand: 'Not_A Brand', version: '24.0.0.0' },
          ],
          fullVersion: '151.0.7922.34',
          platform: 'Linux',
          platformVersion: '6.5.0',
          architecture: 'x86',
          bitness: '64',
          model: '',
          mobile: false,
          wow64: false,
        },
      }).catch(() => {})
      await sendCdp(wsUrl, 'Page.addScriptToEvaluateOnNewDocument', { source: ANTI_DETECT_JS }).catch(() => {})
      await sendCdp(wsUrl, 'Page.addScriptToEvaluateOnNewDocument', { source: AUTO_ALLOW_JS }).catch(() => {})
      await sendCdp(wsUrl, 'Runtime.evaluate', { expression: ANTI_DETECT_JS }).catch(() => {})
      await sendCdp(wsUrl, 'Runtime.evaluate', { expression: AUTO_ALLOW_JS }).catch(() => {})
      const evalResult = await sendCdp(wsUrl, 'Runtime.evaluate', { expression: 'window.location.origin' })
      const origin = evalResult?.result?.value || '*'
      await sendCdp(wsUrl, 'Browser.grantPermissions', { permissions: ['videoCapture', 'audioCapture'], origin }).catch(() => {})
      okCount++
    } catch {}
  }

  return NextResponse.json({ ok: okCount > 0, tabsInjected: okCount })
}
