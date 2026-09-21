import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PID_DIR = '/home/z/my-project/.vnc-pids'

/**
 * Check if a TCP port is actually listening — the most reliable way to know
 * a network service is up. Stale pid files (after a watchdog restart) can't
 * fool this: if port 6080 is listening, websockify is up, period.
 */
function isPortListening(port: number): boolean {
  try {
    const out = execSync('ss -tln 2>/dev/null', { encoding: 'utf8', timeout: 2000 })
    // Match ":PORT " (trailing space) so :6080 doesn't match :60800 etc.
    return new RegExp(`:${port}\\s`, '').test(out)
  } catch {
    return false
  }
}

/** Is the process named in the pid file alive? Fallback for Xvfb (no port). */
function isPidAlive(pidFile: string): boolean {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
    if (!pid || isNaN(pid)) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Is there any running process matching the pattern? (e.g. "Xvfb :99").
 * More robust than a stale pid file after a watchdog restart. */
function isProcessRunning(pattern: string): boolean {
  try {
    const out = execSync(`pgrep -f "${pattern}" 2>/dev/null`, { encoding: 'utf8', timeout: 2000 })
    return out.trim().length > 0
  } catch {
    return false
  }
}

/**
 * GET /api/vnc/status
 * Returns the running state of each VNC component + the noVNC URL.
 *
 * Detection is port-based for the network services (chrome:9222,
 * x11vnc:5900, websockify:6080) so stale pid files (after a watchdog
 * restart) can't cause false "down" reports. Xvfb has no port, so we
 * check the process + pid file.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  // Xvfb: no TCP port — check process name (robust) OR pid file (fallback)
  const xvfb = isProcessRunning('Xvfb :99') || isPidAlive(`${PID_DIR}/xvfb.pid`)
  // Chrome: CDP port 9222 is the real signal
  const chrome = isPortListening(9222)
  // x11vnc: RFB port 5900
  const x11vnc = isPortListening(5900)
  // websockify: HTTP/WS port 6080
  const websockify = isPortListening(6080)

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
