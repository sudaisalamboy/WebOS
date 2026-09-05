import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import fs from 'node:fs'
import http from 'node:http'
import WebSocket from 'ws'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const PID_FILE = '/home/z/my-project/.vnc-pids/chrome.pid'
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
 * Create a new tab via CDP HTTP API (PUT /json/new?url)
 */
function createTab(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: CDP_PORT,
      path: `/json/new?${encodeURIComponent(url)}`,
      method: 'PUT', timeout: 5000,
    }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch { reject(new Error('parse error')) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

/**
 * Close a tab via CDP HTTP API (GET /json/close/<tabId>)
 */
function closeTab(tabId: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/close/${tabId}`, { timeout: 5000 }, () => resolve())
    req.on('error', () => resolve())
    req.on('timeout', () => { req.destroy(); resolve() })
  })
}

/**
 * Get all open tabs
 */
function getTabs(): Promise<any[]> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json`, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve([]) } })
    })
    req.on('error', () => resolve([]))
    req.on('timeout', () => { req.destroy(); resolve([]) })
  })
}

/**
 * POST /api/vnc/control
 * Body: { action: 'back' | 'forward' | 'reload' | 'scroll-down' | 'scroll-up' | 'new-tab' | 'close-tab' }
 *
 * Uses Chrome DevTools Protocol for reliable browser control.
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  // Check Chrome is running via CDP (more reliable than PID check)
  const activeWsUrl = await getTabWsUrl()
  if (!activeWsUrl) {
    // Auto-restart if Chrome is down
    const { spawn } = require('child_process')
    const child = spawn('bash', ['/home/z/my-project/scripts/start-vnc-chrome.sh', 'restart'], {
      cwd: '/home/z/my-project', env: { ...process.env }, timeout: 20000,
    })
    await new Promise((resolve) => {
      child.on('exit', () => resolve(null))
      child.on('error', () => resolve(null))
      setTimeout(resolve, 18000)
    })
    await new Promise((r) => setTimeout(r, 8000))

    const retryWs = await getTabWsUrl()
    if (!retryWs) {
      return NextResponse.json({ error: 'Chrome is not running' }, { status: 503 })
    }
  }

  let body: { action?: string; url?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const action = body.action
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  const wsUrl = await getTabWsUrl()
  if (!wsUrl) {
    return NextResponse.json({ error: 'CDP not available' }, { status: 502 })
  }

  try {
    switch (action) {
      case 'back':
        await sendCdpCommand(wsUrl, 'Page.navigate', { url: 'chrome://back' }).catch(() => {})
        // Alternative: use history navigation
        await sendCdpCommand(wsUrl, 'Page.navigateToHistoryEntry', { entryId: -1 }).catch(() => {})
        break
      case 'forward':
        await sendCdpCommand(wsUrl, 'Page.navigateToHistoryEntry', { entryId: 1 }).catch(() => {})
        break
      case 'reload':
        await sendCdpCommand(wsUrl, 'Page.reload', {})
        break
      case 'force-reload':
        await sendCdpCommand(wsUrl, 'Page.reload', { ignoreCache: true })
        break
      case 'scroll-down':
        await sendCdpCommand(wsUrl, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 800,
        })
        break
      case 'scroll-up':
        await sendCdpCommand(wsUrl, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: -800,
        })
        break
      case 'scroll-page-down':
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
        break
      case 'scroll-page-up':
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
        break
      case 'new-tab':
        await createTab(body.url || 'about:blank')
        break
      case 'close-tab': {
        const tabs = await getTabs()
        const pageTabs = tabs.filter((t) => t.type === 'page')
        if (pageTabs.length > 0) {
          await closeTab(pageTabs[pageTabs.length - 1].id)
        }
        break
      }
      case 'focus-address-bar':
        // Ctrl+L via CDP
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 })
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 })
        await sendCdpCommand(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
        break
      case 'zoom-in':
        await sendCdpCommand(wsUrl, 'Page.setZoom', { zoomFactor: 1.2 })
        break
      case 'zoom-out':
        await sendCdpCommand(wsUrl, 'Page.setZoom', { zoomFactor: 0.8 })
        break
      case 'zoom-reset':
        await sendCdpCommand(wsUrl, 'Page.setZoom', { zoomFactor: 1.0 })
        break
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, action, method: 'CDP' })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message, action }, { status: 502 })
  }
}
