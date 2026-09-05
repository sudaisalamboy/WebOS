import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import fs from 'node:fs'
import http from 'node:http'
import WebSocket from 'ws'
import { ANTI_DETECT_JS } from '@/lib/anti-detect'
import { AUTO_ALLOW_JS } from '@/lib/auto-allow'
import { getCameraInjectScript } from '@/lib/camera-config'

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

async function sendCdpCommand(wsUrl: string, method: string, params: any): Promise<any> {
  const ws = new WebSocket(wsUrl, { origin: 'http://127.0.0.1:9222' })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { try { ws.close() } catch {}; reject(new Error('CDP timeout')) }, 15000)
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.on('message', (data: Buffer) => {
      try {
        const d = JSON.parse(data.toString())
        if (d.id === 1) { clearTimeout(timeout); ws.close(); resolve(d.result) }
      } catch {}
    })
    ws.on('error', () => { clearTimeout(timeout); reject(new Error('WS error')) })
  })
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: { url?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  let url = (body.url || '').trim()
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  // Normalize URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (/\s/.test(url)) {
      url = `https://duckduckgo.com/?q=${encodeURIComponent(url)}`
    } else if (url.includes('.')) {
      url = `https://${url}`
    } else {
      url = `https://duckduckgo.com/?q=${encodeURIComponent(url)}`
    }
  }

  const wsUrl = await getTabWsUrl()
  if (!wsUrl) {
    return NextResponse.json({ error: 'Chrome not running' }, { status: 503 })
  }

  try {
    // === CRITICAL: Register ALL scripts BEFORE navigating ===
    // 1. Anti-detect
    try {
      await sendCdpCommand(wsUrl, 'Page.addScriptToEvaluateOnNewDocument', { source: ANTI_DETECT_JS })
    } catch {}

    // 2. Auto-allow
    try {
      await sendCdpCommand(wsUrl, 'Page.addScriptToEvaluateOnNewDocument', { source: AUTO_ALLOW_JS })
    } catch {}

    // 3. Camera (if enabled)
    const cameraScript = getCameraInjectScript()
    if (cameraScript) {
      try {
        await sendCdpCommand(wsUrl, 'Page.addScriptToEvaluateOnNewDocument', { source: cameraScript })
      } catch {}
    }

    // 4. Grant permissions for current + target origin
    try {
      const currentOriginResult = await sendCdpCommand(wsUrl, 'Runtime.evaluate', { expression: 'window.location.origin' })
      const currentOrigin = currentOriginResult?.result?.value || '*'
      await sendCdpCommand(wsUrl, 'Browser.grantPermissions', { permissions: ['videoCapture', 'audioCapture'], origin: currentOrigin })
      try {
        const targetOrigin = new URL(url).origin
        if (targetOrigin !== currentOrigin) {
          await sendCdpCommand(wsUrl, 'Browser.grantPermissions', { permissions: ['videoCapture', 'audioCapture'], origin: targetOrigin })
        }
      } catch {}
    } catch {}

    // === Navigate ===
    await sendCdpCommand(wsUrl, 'Page.navigate', { url })

    // Wait for page to load
    await new Promise((r) => setTimeout(r, 2000))

    // === Re-inject scripts into loaded page ===
    try { await sendCdpCommand(wsUrl, 'Runtime.evaluate', { expression: ANTI_DETECT_JS, awaitPromise: false }) } catch {}
    try { await sendCdpCommand(wsUrl, 'Runtime.evaluate', { expression: AUTO_ALLOW_JS, awaitPromise: false }) } catch {}
    if (cameraScript) {
      try { await sendCdpCommand(wsUrl, 'Runtime.evaluate', { expression: cameraScript, awaitPromise: false }) } catch {}
    }

    // Grant permissions for new origin
    try {
      const newOriginResult = await sendCdpCommand(wsUrl, 'Runtime.evaluate', { expression: 'window.location.origin' })
      const newOrigin = newOriginResult?.result?.value || '*'
      await sendCdpCommand(wsUrl, 'Browser.grantPermissions', { permissions: ['videoCapture', 'audioCapture'], origin: newOrigin })
    } catch {}

    return NextResponse.json({
      ok: true, url, method: 'CDP',
      antiDetect: 'injected',
      autoAllow: 'injected',
      camera: cameraScript ? 'injected' : 'disabled',
      permissions: 'granted',
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message, url }, { status: 502 })
  }
}
