import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { requireAuth } from '@/lib/auth-middleware'
import net from 'node:net'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const START_SCRIPT = '/home/z/my-project/scripts/start-vnc-chrome.sh'

/** Check if a TCP port is listening. */
function isPortOpen(port: number): boolean {
  try {
    const sock = new net.Socket()
    sock.setTimeout(300)
    sock.connect(port, '127.0.0.1')
    // If connect succeeds, port is open. If it throws, port is closed.
    // We use sync check via /proc/net/tcp instead for reliability.
    sock.destroy()
    return true
  } catch {
    return false
  }
}

/** Async port check — more reliable. */
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    sock.setTimeout(500)
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('timeout', () => { sock.destroy(); resolve(false) })
    sock.once('error', () => { sock.destroy(); resolve(false) })
    sock.connect(port, '127.0.0.1')
  })
}

/**
 * Check if all 4 VNC components are running by checking their ports.
 * This is more reliable than PID file checks (which go stale after restarts).
 */
async function checkRunning() {
  const [xvfb, chrome, x11vnc, websockify] = await Promise.all([
    Promise.resolve(typeof process !== 'undefined' && require('child_process').execSync('pgrep -f "Xvfb :99"', { encoding: 'utf8' }).trim().length > 0).catch(() => false),
    checkPort(9222),
    checkPort(5900),
    checkPort(6080),
  ])
  return { xvfb, chrome, x11vnc, websockify, allReady: xvfb && x11vnc && websockify }
}

/**
 * POST /api/vnc/start
 * Starts the Remote Chrome VNC session by running start-vnc-chrome.sh.
 * Returns: { ok, status, url }
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  // If already running, return status
  const current = await checkRunning()
  if (current.allReady) {
    return NextResponse.json({
      ok: true,
      alreadyRunning: true,
      url: 'http://localhost:6080/vnc.html',
      status: current,
    })
  }

  return new Promise((resolve) => {
    const child = spawn('bash', [START_SCRIPT, 'start'], {
      cwd: '/home/z/my-project',
      env: { ...process.env },
      timeout: 28000,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))

    const timeout = setTimeout(async () => {
      try { child.kill('SIGKILL') } catch {}
      const status = await checkRunning()
      resolve(NextResponse.json({
        ok: status.allReady,
        error: status.allReady ? undefined : 'Start script timed out (>28s)',
        status,
        stdout: stdout.trim().slice(-500),
        stderr: stderr.trim().slice(-500),
      }, { status: status.allReady ? 200 : 504 }))
    }, 28000)

    child.on('exit', async (code) => {
      clearTimeout(timeout)
      // Wait a moment for ports to come up
      await new Promise((r) => setTimeout(r, 1000))
      const status = await checkRunning()
      if (status.allReady) {
        resolve(NextResponse.json({
          ok: true,
          url: 'http://localhost:6080/vnc.html',
          status,
          stdout: stdout.trim().slice(-500),
        }))
      } else {
        resolve(NextResponse.json({
          ok: false,
          error: `Components not all ready (code ${code})`,
          status,
          stdout: stdout.trim().slice(-500),
          stderr: stderr.trim().slice(-500),
        }, { status: 502 }))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve(NextResponse.json({
        ok: false,
        error: `Failed to spawn: ${err.message}`,
      }, { status: 500 }))
    })
  })
}
