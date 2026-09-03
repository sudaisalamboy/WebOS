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

/** Dispatch a key press (down + up) via CDP Input.dispatchKeyEvent. */
async function pressKey(wsUrl: string, opts: {
  key: string,
  code?: string,
  windowsVirtualKeyCode?: number,
  modifiers?: number,  // 1=Alt, 2=Ctrl, 4=Meta, 8=Shift
}) {
  const params = {
    type: 'keyDown',
    key: opts.key,
    code: opts.code || opts.key,
    windowsVirtualKeyCode: opts.windowsVirtualKeyCode,
    modifiers: opts.modifiers || 0,
  }
  await sendCdp(wsUrl, 'Input.dispatchKeyEvent', params)
  await sendCdp(wsUrl, 'Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
}

/** Dispatch a char-typed key event (used for printable chars with modifiers). */
async function typeKey(wsUrl: string, opts: {
  text: string,
  modifiers?: number,
}) {
  await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
    type: 'char',
    text: opts.text,
    modifiers: opts.modifiers || 0,
  })
}

// Virtual key codes
const VK: Record<string, number> = {
  Enter: 13, Tab: 9, Backspace: 8, Escape: 27,
  Delete: 46, Space: 32,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  a: 65, b: 66, c: 67, d: 68, e: 69, l: 76, v: 86, x: 88,
  A: 65, B: 66, C: 67, D: 68, E: 69, L: 76, V: 86, X: 88,
}

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

/**
 * POST /api/vnc/keypress
 * Body: {
 *   action: 'press' | 'type' | 'combo',
 *   key?: string,          // for 'press': key name like "Tab", "Enter", "Backspace", "Escape", "c"
 *   text?: string,         // for 'type': text to type char by char
 *   ctrl?: boolean,        // for 'combo': Ctrl+key
 *   shift?: boolean,
 *   meta?: boolean,        // Cmd on Mac
 *   comboKey?: string,     // for 'combo': the key to combine with modifiers (e.g. "a" for Ctrl+A)
 * }
 *
 * Examples:
 *   { action: 'press', key: 'Tab' }
 *   { action: 'press', key: 'Enter' }
 *   { action: 'press', key: 'Backspace' }
 *   { action: 'combo', ctrl: true, comboKey: 'a' }    // Ctrl+A (select all)
 *   { action: 'combo', ctrl: true, comboKey: 'Enter' } // Ctrl+Enter (send)
 *   { action: 'type', text: 'hello@biz.com' }
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const wsUrl = await getTabWsUrl()
  if (!wsUrl) {
    return NextResponse.json({ ok: false, error: 'Chrome not running' }, { status: 503 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  try {
    if (body.action === 'press') {
      const key = body.key
      if (!key) return NextResponse.json({ ok: false, error: 'key required' }, { status: 400 })
      await pressKey(wsUrl, {
        key,
        code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
        windowsVirtualKeyCode: VK[key] || 0,
        modifiers: 0,
      })
      return NextResponse.json({ ok: true, action: 'press', key })
    }

    if (body.action === 'combo') {
      const comboKey = body.comboKey
      if (!comboKey) return NextResponse.json({ ok: false, error: 'comboKey required' }, { status: 400 })
      let modifiers = 0
      if (body.ctrl) modifiers |= MOD.ctrl
      if (body.shift) modifiers |= MOD.shift
      if (body.meta) modifiers |= MOD.meta
      if (body.alt) modifiers |= MOD.alt
      // For Ctrl+A etc., dispatch as a "raw key down" with modifiers
      const code = comboKey.length === 1 ? `Key${comboKey.toUpperCase()}` : comboKey
      // Press Ctrl (if specified), then the key, then release
      if (body.ctrl) {
        await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: 'Control', code: 'ControlLeft',
          windowsVirtualKeyCode: 17, modifiers: 0,
        })
      }
      if (body.shift) {
        await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft',
          windowsVirtualKeyCode: 16, modifiers: 0,
        })
      }
      if (body.meta) {
        await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: 'Meta', code: 'MetaLeft',
          windowsVirtualKeyCode: 91, modifiers: 0,
        })
      }
      // Press the actual key with modifiers
      await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: comboKey, code,
        windowsVirtualKeyCode: VK[comboKey] || (comboKey.charCodeAt(0)),
        modifiers,
      })
      await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: comboKey, code,
        windowsVirtualKeyCode: VK[comboKey] || (comboKey.charCodeAt(0)),
        modifiers,
      })
      // Release modifier keys
      if (body.meta) {
        await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Meta', code: 'MetaLeft',
          windowsVirtualKeyCode: 91, modifiers: 0,
        })
      }
      if (body.shift) {
        await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Shift', code: 'ShiftLeft',
          windowsVirtualKeyCode: 16, modifiers: 0,
        })
      }
      if (body.ctrl) {
        await sendCdp(wsUrl, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Control', code: 'ControlLeft',
          windowsVirtualKeyCode: 17, modifiers: 0,
        })
      }
      const modStr = [
        body.ctrl && 'Ctrl', body.shift && 'Shift', body.meta && 'Meta', body.alt && 'Alt',
      ].filter(Boolean).join('+')
      return NextResponse.json({ ok: true, action: 'combo', combo: `${modStr}+${comboKey}` })
    }

    if (body.action === 'type') {
      const text = body.text
      if (!text) return NextResponse.json({ ok: false, error: 'text required' }, { status: 400 })
      // Use Input.insertText — most reliable for typing visible text
      await sendCdp(wsUrl, 'Input.insertText', { text })
      return NextResponse.json({ ok: true, action: 'type', length: text.length })
    }

    return NextResponse.json({ ok: false, error: `unknown action: ${body.action}` }, { status: 400 })
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
