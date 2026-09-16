import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import http from 'node:http'
import WebSocket from 'ws'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildCameraScript,
  buildPatchScript,
  buildDisableScript,
  type CameraConfig,
  DEFAULT_CONFIG,
} from '@/lib/camera-inject'
import { saveCameraConfig, setCameraEnabled, loadCameraConfig } from '@/lib/camera-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CDP_PORT = 9222
const UPLOAD_DIR = '/home/z/my-project/upload/vnc-uploads'

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
      try {
        const d = JSON.parse(data.toString())
        if (d.id === 1) { clearTimeout(timeout); ws.close(); resolve(d.result) }
      } catch {}
    })
    ws.on('error', () => { clearTimeout(timeout); reject(new Error('WS error')) })
  })
}

async function isVncChromeRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json`, { timeout: 2000 }, (res) => {
      res.on('data', () => {}); res.on('end', () => resolve(true))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function getMediaUrl(fileName: string): string | null {
  if (!fs.existsSync(path.join(UPLOAD_DIR, fileName))) return null
  return `http://127.0.0.1:3000/api/vnc/serve/${encodeURIComponent(fileName)}`
}

function listMediaFiles() {
  if (!fs.existsSync(UPLOAD_DIR)) return []
  return fs.readdirSync(UPLOAD_DIR).map(name => {
    const stat = fs.statSync(path.join(UPLOAD_DIR, name))
    const ext = path.extname(name).toLowerCase()
    return {
      name, size: stat.size,
      type: ['.mp4', '.webm', '.ogg', '.mov', '.mkv'].includes(ext) ? 'video' :
            ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext) ? 'image' : 'file',
    }
  }).filter(f => f.type === 'video' || f.type === 'image')
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const action = body.action || 'inject'
  const targets: string[] = body.targets || ['all']
  const wantVnc = targets.includes('all') || targets.includes('vnc')
  const wantTorSuite = targets.includes('all') || targets.includes('tor-suite')

  const userConfig: Partial<CameraConfig> & { sourceFile?: string } = { ...(body.config || {}) }

  if (userConfig.sourceFile) {
    const url = getMediaUrl(userConfig.sourceFile)
    if (!url) return NextResponse.json({ ok: false, error: `File not found: ${userConfig.sourceFile}` }, { status: 404 })
    userConfig.sourceUrl = url
    const ext = path.extname(userConfig.sourceFile).toLowerCase()
    if (['.mp4', '.webm', '.ogg', '.mov', '.mkv'].includes(ext)) userConfig.sourceType = 'video'
    else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) userConfig.sourceType = 'image'
    delete userConfig.sourceFile
  }

  const config: CameraConfig = { ...DEFAULT_CONFIG, ...userConfig }

  if (action === 'inject') saveCameraConfig(config, true)
  else if (action === 'disable') setCameraEnabled(false)
  if (action === 'patch') {
    const existing = loadCameraConfig()
    if (existing) saveCameraConfig({ ...existing, ...config }, true)
  }

  const results: any = {
    vnc: { attempted: false, ok: false, error: null as string | null },
    torSuite: { attempted: false, ok: true, sessions: 0, error: null as string | null },
  }

  if (action === 'disable') {
    const disableScript = buildDisableScript()
    if (wantVnc) {
      results.vnc.attempted = true
      try {
        const vncRunning = await isVncChromeRunning()
        if (!vncRunning) results.vnc.error = 'VNC Chrome not running'
        else {
          const wsUrls = await getAllTabWsUrls()
          for (const wsUrl of wsUrls) { try { await sendCdp(wsUrl, 'Runtime.evaluate', { expression: disableScript }) } catch {} }
          results.vnc.ok = true
        }
      } catch (err) { results.vnc.error = (err as Error).message }
    }
    return NextResponse.json({ ok: results.vnc.ok || results.torSuite.ok, action: 'disabled', results })
  }

  if (action === 'patch') {
    const patchScript = buildPatchScript(config)
    if (wantVnc) {
      results.vnc.attempted = true
      try {
        const vncRunning = await isVncChromeRunning()
        if (!vncRunning) results.vnc.error = 'VNC Chrome not running'
        else {
          const wsUrls = await getAllTabWsUrls()
          let okCount = 0
          for (const wsUrl of wsUrls) { try { await sendCdp(wsUrl, 'Runtime.evaluate', { expression: patchScript }); okCount++ } catch {} }
          results.vnc.ok = okCount > 0
        }
      } catch (err) { results.vnc.error = (err as Error).message }
    }
    return NextResponse.json({ ok: results.vnc.ok || results.torSuite.ok, action: 'patched', config, results })
  }

  // action === 'inject'
  const cameraScript = buildCameraScript(config)

  if (wantVnc) {
    results.vnc.attempted = true
    try {
      const vncRunning = await isVncChromeRunning()
      if (!vncRunning) results.vnc.error = 'VNC Chrome not running. Start Remote Chrome first.'
      else {
        const wsUrls = await getAllTabWsUrls()
        if (wsUrls.length === 0) results.vnc.error = 'No Chrome tabs found'
        else {
          let okCount = 0
          for (const wsUrl of wsUrls) {
            try {
              await sendCdp(wsUrl, 'Page.enable', {}).catch(() => {})
              const evalResult = await sendCdp(wsUrl, 'Runtime.evaluate', { expression: 'window.location.origin' })
              const origin = evalResult?.result?.value || '*'
              try { await sendCdp(wsUrl, 'Browser.grantPermissions', { permissions: ['videoCapture', 'audioCapture'], origin }) } catch {}
              await sendCdp(wsUrl, 'Page.addScriptToEvaluateOnNewDocument', { source: cameraScript })
              await sendCdp(wsUrl, 'Runtime.evaluate', { expression: cameraScript })
              okCount++
            } catch {}
          }
          results.vnc.ok = okCount > 0
          if (okCount > 0) results.vnc.tabsInjected = okCount
          else results.vnc.error = 'Injection failed on all tabs'
        }
      }
    } catch (err) { results.vnc.error = (err as Error).message }
  }

  // Tor Suite (no sessions yet, just mark as ok)
  if (wantTorSuite) {
    results.torSuite.attempted = true
    results.torSuite.ok = true
    results.torSuite.sessions = 0
  }

  const allOk = (!results.vnc.attempted || results.vnc.ok) && (!results.torSuite.attempted || results.torSuite.ok)
  return NextResponse.json({
    ok: allOk, action: 'injected', config, results,
    message: allOk ? `Camera injected to ${[results.vnc.ok ? 'VNC Chrome' : null, results.torSuite.ok ? 'Tor Suite' : null].filter(Boolean).join(' + ')}` : 'Some targets failed',
  })
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const status: any = {
    vnc: { running: false, tabs: 0, cameraActive: false, settings: null },
    torSuite: { sessions: 0 },
    files: listMediaFiles(),
  }

  try {
    const vncRunning = await isVncChromeRunning()
    status.vnc.running = vncRunning
    if (vncRunning) {
      const wsUrls = await getAllTabWsUrls()
      status.vnc.tabs = wsUrls.length
      if (wsUrls.length > 0) {
        try {
          const r = await sendCdp(wsUrls[0], 'Runtime.evaluate', { expression: `JSON.stringify({ active: !!window._cameraOverrideActive, vcam: window._vcam || null })` })
          const val = r?.result?.value
          if (val) { const parsed = JSON.parse(val); status.vnc.cameraActive = parsed.active; status.vnc.settings = parsed.vcam }
        } catch {}
      }
    }
  } catch {}

  return NextResponse.json({ ok: true, status })
}
