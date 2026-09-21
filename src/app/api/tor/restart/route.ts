import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const START_SCRIPT = '/home/z/my-project/scripts/start-tor.sh'

/**
 * POST /api/tor/restart
 *
 * Restarts the Tor daemon by running /home/z/my-project/scripts/start-tor.sh.
 * Used by the Tor Browser UI as a "recover" button when the daemon is down
 * (e.g. after a container reset).
 *
 * Returns: { ok: boolean, message: string }
 */
export async function POST(_req: NextRequest) {
  const authError = requireAuth(_req)
  if (authError) return authError

  return new Promise((resolve) => {
    const child = spawn('bash', [START_SCRIPT, 'restart'], {
      cwd: '/home/z/my-project',
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))

    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      resolve(NextResponse.json(
        { ok: false, message: 'Restart timed out (tor script took >20s)', stdout, stderr },
        { status: 504 }
      ))
    }, 20000)

    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(NextResponse.json({
          ok: true,
          message: 'Tor daemon restarted. Bootstrap takes ~10-20s — check /api/tor/status for progress.',
          stdout: stdout.trim(),
        }))
      } else {
        resolve(NextResponse.json({
          ok: false,
          message: `Restart script exited with code ${code}`,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        }, { status: 502 }))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve(NextResponse.json({
        ok: false,
        message: `Failed to spawn restart script: ${err.message}`,
      }, { status: 500 }))
    })
  })
}
