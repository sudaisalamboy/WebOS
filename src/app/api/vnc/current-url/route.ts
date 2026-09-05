import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import fs from 'node:fs'
import http from 'node:http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 5

const PID_FILE = '/home/z/my-project/.vnc-pids/chrome.pid'
const CDP_PORT = 9222

/**
 * Get the current URL of the active Chrome tab via CDP.
 * Used by the tools panel so tools run against the page the user is viewing.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  // Check Chrome is running
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    process.kill(pid, 0)
  } catch {
    return NextResponse.json({ error: 'Chrome is not running' }, { status: 503 })
  }

  return new Promise((resolve) => {
    const r = http.get(`http://127.0.0.1:${CDP_PORT}/json`, { timeout: 3000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const tabs = JSON.parse(body)
          const pageTab = tabs.find((t: any) => t.type === 'page')
          if (pageTab) {
            resolve(NextResponse.json({
              url: pageTab.url,
              title: pageTab.title,
              host: (() => { try { return new URL(pageTab.url).hostname } catch { return '' } })(),
            }))
          } else {
            resolve(NextResponse.json({ error: 'no page tab found' }, { status: 404 }))
          }
        } catch {
          resolve(NextResponse.json({ error: 'CDP parse error' }, { status: 502 }))
        }
      })
    })
    r.on('error', () => resolve(NextResponse.json({ error: 'CDP not available' }, { status: 502 })))
    r.on('timeout', () => { r.destroy(); resolve(NextResponse.json({ error: 'CDP timeout' }, { status: 504 })) })
  })
}
