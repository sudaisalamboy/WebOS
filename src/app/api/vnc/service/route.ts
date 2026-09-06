import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { spawn, execSync } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const PID_DIR = '/home/z/my-project/.vnc-pids'
const LOG_DIR = '/home/z/my-project/.vnc-logs'
const CHROME_BIN = '/home/z/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const XVFB_BIN = '/usr/bin/Xvfb'
const X11VNC_BIN = '/home/z/my-project/tools/x11vnc/bin/x11vnc'
const X11VNC_LIB = '/home/z/my-project/tools/x11vnc/lib'
const NOVNC_DIR = '/home/z/my-project/tools/novnc'
const WEBSOCKIFY_BIN = '/home/z/.venv/bin/websockify'
const CHROME_PROFILE = '/home/z/.config/google-chrome-for-testing'

const DISPLAY_NUM = 99
const VNC_PORT = 5900
const WS_PORT = 6080
const CDP_PORT = 9222

// Ensure dirs exist
try { fs.mkdirSync(PID_DIR, { recursive: true }) } catch {}
try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch {}

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

function pgrep(pattern: string): boolean {
  // Use pgrep -f to match the full command line. But pgrep -f can match
  // the bash subprocess that's running the pgrep command itself (because
  // the command string contains the pattern). To avoid this, we use
  // pgrep -f with -x (exact) won't work for full command lines, so instead
  // we filter out our own PID + parent PIDs.
  try {
    // Use pgrep -f, then verify each match is a real process (not our subprocess)
    const result = execSync(`pgrep -f "${pattern}" 2>/dev/null`, { encoding: 'utf8' })
    const pids = result.trim().split('\n').filter(Boolean).map(p => parseInt(p))
    if (pids.length === 0) return false
    // Filter out our own process + immediate parents (which may contain the
    // pattern in their command line because they spawned us)
    const myPid = process.pid
    const realPids = pids.filter(pid => {
      if (pid === myPid) return false
      if (pid === process.ppid) return false
      // Read /proc/<pid>/cmdline to verify it's a real match
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
        // /proc cmdline uses null bytes as separators
        const cmd = cmdline.replace(/\0/g, ' ').trim()
        // Check if the pattern actually appears in the real command
        return cmd.includes(pattern.replace(/\\/g, ''))
      } catch {
        return false
      }
    })
    return realPids.length > 0
  } catch {
    return false
  }
}

function killPattern(pattern: string, timeoutMs: number = 3000): boolean {
  // Kill processes matching the pattern, then verify they're actually dead.
  // Use the same /proc/<pid>/cmdline verification as pgrep to avoid
  // killing our own subprocesses.
  const killOnce = () => {
    try {
      const result = execSync(`pgrep -f "${pattern}" 2>/dev/null`, { encoding: 'utf8' })
      const pids = result.trim().split('\n').filter(Boolean).map(p => parseInt(p))
      const myPid = process.pid
      const realPids = pids.filter(pid => {
        if (pid === myPid || pid === process.ppid) return false
        try {
          const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
          return cmd.includes(pattern.replace(/\\/g, ''))
        } catch { return false }
      })
      for (const pid of realPids) {
        try { process.kill(pid, 'SIGKILL') } catch {}
      }
      return realPids.length
    } catch { return 0 }
  }
  killOnce()
  // Wait + verify
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pgrep(pattern)) return true
    killOnce()
    // Small sleep (sync)
    const start = Date.now()
    while (Date.now() - start < 300) { /* busy wait */ }
  }
  return !pgrep(pattern)
}

function pidAlive(pidFile: string): boolean {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killPid(pidFile: string) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
    try { process.kill(pid, 'SIGTERM') } catch {}
    setTimeout(() => {
      try { process.kill(pid, 'SIGKILL') } catch {}
    }, 2000)
  } catch {}
  try { fs.unlinkSync(pidFile) } catch {}
}

function startPython(cmd: string, pidFile: string, logFile: string): boolean {
  try {
    const p = spawn('python3', ['-c', cmd], {
      cwd: '/home/z/my-project',
      env: { ...process.env, DISPLAY: `:${DISPLAY_NUM}`, HOME: '/home/z',
             XDG_RUNTIME_DIR: '/tmp/runtime-z' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    p.stdout?.pipe(fs.createWriteStream(logFile, { flags: 'a' }))
    p.stderr?.pipe(fs.createWriteStream(logFile, { flags: 'a' }))
    fs.writeFileSync(pidFile, String(p.pid))
    p.unref()
    return true
  } catch {
    return false
  }
}

async function getServiceStatus() {
  const [xvfb, chrome, x11vnc, websockify] = await Promise.all([
    Promise.resolve(pgrep(`Xvfb :${DISPLAY_NUM}`)),
    checkPort(CDP_PORT),
    checkPort(VNC_PORT),
    checkPort(WS_PORT),
  ])
  return { xvfb, chrome, x11vnc, websockify }
}

async function startService(service: string): Promise<{ ok: boolean; error?: string }> {
  // Create runtime dir if needed
  try { fs.mkdirSync('/tmp/runtime-z', { recursive: true }) } catch {}
  try { fs.chmodSync('/tmp/runtime-z', 0o700) } catch {}

  switch (service) {
    case 'xvfb': {
      if (pgrep(`Xvfb :${DISPLAY_NUM}`)) return { ok: true, error: 'already running' }
      return new Promise((resolve) => {
        const p = spawn(XVFB_BIN, [
          `:${DISPLAY_NUM}`, '-screen', '0', '1280x800x24',
          '-ac', '-nolisten', 'tcp',
        ], {
          stdio: ['ignore', fs.openSync(`${LOG_DIR}/xvfb.log`, 'a'), fs.openSync(`${LOG_DIR}/xvfb.log`, 'a')],
          detached: true,
        })
        fs.writeFileSync(`${PID_DIR}/xvfb.pid`, String(p.pid))
        p.unref()
        setTimeout(() => resolve({ ok: pgrep(`Xvfb :${DISPLAY_NUM}`) }), 2000)
      })
    }
    case 'chrome': {
      if (await checkPort(CDP_PORT)) return { ok: true, error: 'already running' }
      // Make sure Xvfb is running first — Chrome needs a display.
      // Auto-start Xvfb if it's down, then wait for it to be ready.
      if (!pgrep(`Xvfb :${DISPLAY_NUM}`)) {
        const xvfbResult = await startService('xvfb')
        if (!xvfbResult.ok) return { ok: false, error: 'failed to start Xvfb (Chrome needs it)' }
        // Wait for Xvfb to be ready (poll pgrep up to 5s)
        for (let i = 0; i < 10; i++) {
          if (pgrep(`Xvfb :${DISPLAY_NUM}`)) break
          await new Promise(r => setTimeout(r, 500))
        }
        if (!pgrep(`Xvfb :${DISPLAY_NUM}`)) {
          return { ok: false, error: 'Xvfb did not start — cannot launch Chrome' }
        }
      }
      return new Promise((resolve) => {
        const env = {
          ...process.env,
          DISPLAY: `:${DISPLAY_NUM}`,
          HOME: '/home/z',
          XDG_RUNTIME_DIR: '/tmp/runtime-z',
          PULSE_SERVER: 'unix:/tmp/runtime-z/pulse/native',
        }
        const p = spawn(CHROME_BIN, [
          '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
          '--no-default-browser-check', '--disable-sync', '--disable-translate',
          '--disable-session-crashed-bubble', '--ignore-certificate-errors',
          '--disable-blink-features=AutomationControlled',
          '--autoplay-policy=no-user-gesture-required',
          `--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
          `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
          '--window-size=1280,800', '--window-position=0,0',
          `--user-data-dir=${CHROME_PROFILE}`,
          'https://duckduckgo.com',
        ], { env, stdio: ['ignore', fs.openSync(`${LOG_DIR}/chrome.log`, 'a'), fs.openSync(`${LOG_DIR}/chrome.log`, 'a')], detached: true })
        fs.writeFileSync(`${PID_DIR}/chrome.pid`, String(p.pid))
        p.unref()
        // Wait up to 12s for Chrome to come up (it's slow to start)
        let waited = 0
        const interval = setInterval(async () => {
          waited += 1000
          if (await checkPort(CDP_PORT)) {
            clearInterval(interval)
            resolve({ ok: true })
          } else if (waited >= 12000) {
            clearInterval(interval)
            resolve({ ok: false, error: 'Chrome did not start within 12s — check log' })
          }
        }, 1000)
      })
    }
    case 'x11vnc': {
      if (await checkPort(VNC_PORT)) return { ok: true, error: 'already running' }
      if (!pgrep(`Xvfb :${DISPLAY_NUM}`)) return { ok: false, error: 'Xvfb not running — start Xvfb first' }
      // Start x11vnc watchdog (which starts x11vnc)
      return new Promise((resolve) => {
        const p = spawn('python3', ['/home/z/my-project/scripts/x11vnc-watchdog.py'], {
          cwd: '/home/z/my-project',
          env: { ...process.env },
          stdio: ['ignore', 'ignore', 'ignore'],
          detached: true,
        })
        fs.writeFileSync(`${PID_DIR}/watchdog.pid`, String(p.pid))
        p.unref()
        setTimeout(async () => resolve({ ok: await checkPort(VNC_PORT) }), 5000)
      })
    }
    case 'websockify': {
      if (await checkPort(WS_PORT)) return { ok: true, error: 'already running' }
      if (!(await checkPort(VNC_PORT))) return { ok: false, error: 'x11vnc not running — start x11vnc first' }
      return new Promise((resolve) => {
        const p = spawn(WEBSOCKIFY_BIN, [
          '--web', NOVNC_DIR, String(WS_PORT), `127.0.0.1:${VNC_PORT}`,
        ], {
          cwd: '/home/z/my-project',
          env: { ...process.env },
          stdio: ['ignore', fs.openSync(`${LOG_DIR}/websockify.log`, 'a'), fs.openSync(`${LOG_DIR}/websockify.log`, 'a')],
          detached: true,
        })
        fs.writeFileSync(`${PID_DIR}/websockify.pid`, String(p.pid))
        p.unref()
        setTimeout(async () => resolve({ ok: await checkPort(WS_PORT) }), 3000)
      })
    }
    case 'all': {
      // Start all 4 in order
      const results: Record<string, boolean> = {}
      if (!pgrep(`Xvfb :${DISPLAY_NUM}`)) { const r = await startService('xvfb'); results.xvfb = r.ok }
      else results.xvfb = true
      if (!(await checkPort(CDP_PORT))) { const r = await startService('chrome'); results.chrome = r.ok }
      else results.chrome = true
      if (!(await checkPort(VNC_PORT))) { const r = await startService('x11vnc'); results.x11vnc = r.ok }
      else results.x11vnc = true
      if (!(await checkPort(WS_PORT))) { const r = await startService('websockify'); results.websockify = r.ok }
      else results.websockify = true
      return { ok: Object.values(results).every(v => v) }
    }
    default:
      return { ok: false, error: `unknown service: ${service}` }
  }
}

async function stopService(service: string): Promise<{ ok: boolean; error?: string }> {
  switch (service) {
    case 'xvfb':
      // Kill Xvfb + verify it's actually dead. Also kill dependent services
      // (Chrome, x11vnc, websockify) since they depend on Xvfb being up.
      killPattern(`Xvfb :${DISPLAY_NUM}`)
      // Give dependents a moment to die, then clean them up
      killPattern(`remote-debugging-port=${CDP_PORT}`)
      killPattern(`x11vnc -display`)
      killPattern(`x11vnc-watchdog`)
      try { fs.unlinkSync(`${PID_DIR}/xvfb.pid`) } catch {}
      try { fs.unlinkSync(`${PID_DIR}/chrome.pid`) } catch {}
      try { fs.unlinkSync(`${PID_DIR}/x11vnc.pid`) } catch {}
      try { fs.unlinkSync(`${PID_DIR}/watchdog.pid`) } catch {}
      return { ok: !pgrep(`Xvfb :${DISPLAY_NUM}`) }
    case 'chrome':
      killPattern(`remote-debugging-port=${CDP_PORT}`)
      try { fs.unlinkSync(`${PID_DIR}/chrome.pid`) } catch {}
      // Wait briefly for the port to free up
      await new Promise(r => setTimeout(r, 500))
      return { ok: !pgrep(`remote-debugging-port=${CDP_PORT}`) }
    case 'x11vnc':
      killPattern(`x11vnc -display`)
      killPattern(`x11vnc-watchdog`)
      try { fs.unlinkSync(`${PID_DIR}/x11vnc.pid`) } catch {}
      try { fs.unlinkSync(`${PID_DIR}/watchdog.pid`) } catch {}
      return { ok: !pgrep(`x11vnc -display`) }
    case 'websockify':
      killPattern(`websockify`)
      try { fs.unlinkSync(`${PID_DIR}/websockify.pid`) } catch {}
      return { ok: !pgrep(`websockify`) }
    case 'all': {
      await stopService('websockify')
      await stopService('x11vnc')
      await stopService('chrome')
      await stopService('xvfb')
      return { ok: true }
    }
    default:
      return { ok: false, error: `unknown service: ${service}` }
  }
}

function getLogTail(service: string, lines: number = 20): string {
  const logMap: Record<string, string> = {
    xvfb: `${LOG_DIR}/xvfb.log`,
    chrome: `${LOG_DIR}/chrome.log`,
    x11vnc: `${LOG_DIR}/x11vnc.log`,
    websockify: `${LOG_DIR}/websockify.log`,
  }
  const logFile = logMap[service]
  if (!logFile || !fs.existsSync(logFile)) return ''
  try {
    const content = fs.readFileSync(logFile, 'utf8')
    const allLines = content.split('\n')
    return allLines.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

/**
 * GET /api/vnc/service?name=xvfb&lines=20  → status of all services + log tail
 * GET /api/vnc/service                     → status of all 4 services
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const url = new URL(req.url)
  const name = url.searchParams.get('name')
  const lines = parseInt(url.searchParams.get('lines') || '20')

  const status = await getServiceStatus()

  if (name) {
    const log = getLogTail(name, lines)
    return NextResponse.json({ ok: true, service: name, status: (status as any)[name], log })
  }

  return NextResponse.json({ ok: true, services: status })
}

/**
 * POST /api/vnc/service
 * Body: { action: 'start' | 'stop' | 'restart', service: 'xvfb' | 'chrome' | 'x11vnc' | 'websockify' | 'all' }
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  let body: { action?: string; service?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  const action = body.action
  const service = body.service
  if (!action || !service) {
    return NextResponse.json({ ok: false, error: 'action and service required' }, { status: 400 })
  }

  try {
    if (action === 'start') {
      const result = await startService(service)
      const status = await getServiceStatus()
      return NextResponse.json({ ok: result.ok, action, service, result, status })
    }
    if (action === 'stop') {
      const result = await stopService(service)
      const status = await getServiceStatus()
      return NextResponse.json({ ok: result.ok, action, service, result, status })
    }
    if (action === 'restart') {
      await stopService(service)
      await new Promise(r => setTimeout(r, 2000))
      const result = await startService(service)
      const status = await getServiceStatus()
      return NextResponse.json({ ok: result.ok, action, service, result, status })
    }
    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
