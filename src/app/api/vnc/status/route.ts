import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import fs from 'node:fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PID_DIR = '/home/z/my-project/.vnc-pids'

function isAlive(pidFile: string): boolean {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
    if (!pid || isNaN(pid)) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * GET /api/vnc/status
 * Returns the running state of each VNC component + the noVNC URL.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const xvfb = isAlive(`${PID_DIR}/xvfb.pid`)
  const chrome = isAlive(`${PID_DIR}/chrome.pid`)
  const x11vnc = isAlive(`${PID_DIR}/x11vnc.pid`)
  const websockify = isAlive(`${PID_DIR}/websockify.pid`)
  const allReady = xvfb && x11vnc && websockify

  return NextResponse.json({
    running: allReady,
    allReady,
    components: { xvfb, chrome, x11vnc, websockify },
    url: allReady ? 'http://localhost:6080/vnc.html' : null,
    password: 'webos',
    display: ':99 (1280x800)',
  })
}
