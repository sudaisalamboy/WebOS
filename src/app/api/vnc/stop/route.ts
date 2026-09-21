import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const STOP_SCRIPT = '/home/z/my-project/scripts/start-vnc-chrome.sh'

/**
 * POST /api/vnc/stop
 * Stops the Remote Chrome VNC session.
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  return new Promise((resolve) => {
    const child = spawn('bash', [STOP_SCRIPT, 'stop'], {
      cwd: '/home/z/my-project',
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))

    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      resolve(NextResponse.json({ ok: true, message: 'Stop command sent (timed out waiting)' }))
    }, 10000)

    child.on('exit', (code) => {
      clearTimeout(timeout)
      resolve(NextResponse.json({
        ok: code === 0,
        stdout: stdout.trim().slice(-300),
      }))
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve(NextResponse.json({ ok: false, error: err.message }, { status: 500 }))
    })
  })
}
