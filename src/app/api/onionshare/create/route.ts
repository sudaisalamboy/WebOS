import { NextRequest, NextResponse } from 'next/server'
import { spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ONIONSHARE_SCRIPT = '/home/z/my-project/scripts/start-onionshare.sh'
const STATE_DIR = '/home/z/my-project/onionshare/state'

// In-memory registry of running shares (persists across requests in dev mode)
interface RunningShare {
  id: string
  mode: 'share' | 'receive' | 'website'
  files: string[]
  onionUrl: string | null
  privateKey: string | null
  status: 'starting' | 'running' | 'stopped' | 'error'
  startedAt: number
  pid: number | null
  process: ChildProcess | null
  outputLog: string[]
}

declare global {
  var __onionshare_shares: Map<string, RunningShare> | undefined
}

const shares: Map<string, RunningShare> =
  globalThis.__onionshare_shares ?? (globalThis.__onionshare_shares = new Map())

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true })
  }
}

function makeId(): string {
  return randomBytes(6).toString('hex')
}

/** Spawn onionshare in bundled mode (it spawns its own tor — works reliably). */
function startOnionshare(
  id: string,
  mode: 'share' | 'receive' | 'website',
  files: string[]
): void {
  const args: string[] = [
    '--verbose',
  ]
  if (mode === 'receive') args.push('--receive')
  if (mode === 'website') args.push('--website')
  // Public mode = no private key needed to access (simpler)
  args.push('--public')
  // Don't auto-stop after first download (for share mode)
  if (mode === 'share') args.push('--no-autostop-sharing')
  // Add files (for share/website modes)
  for (const f of files) args.push(f)

  const proc = spawn(ONIONSHARE_SCRIPT, args, {
    cwd: '/home/z/my-project/onionshare',
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',  // critical: don't buffer stdout
      // Each share gets its own config dir to avoid state conflicts
      ONIONSHARE_HOME: `/home/z/.config/onionshare-${id}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const share = shares.get(id)
  if (!share) return
  share.process = proc
  share.pid = proc.pid ?? null

  const onLine = (line: string) => {
    if (!line.trim()) return
    share.outputLog.push(line)
    if (share.outputLog.length > 500) share.outputLog.shift()

    // Look for the .onion URL line (matches "Give this address" + URL)
    const urlMatch = line.match(/(http:\/\/[a-z2-7]{56}\.onion)/i)
    if (urlMatch && !share.onionUrl) {
      share.onionUrl = urlMatch[1]
      share.status = 'running'
    }
    // Look for private key (when --public is NOT used)
    const pkMatch = line.match(/Private key:\s*([A-Z2-7]+)/)
    if (pkMatch && !share.privateKey) {
      share.privateKey = pkMatch[1]
    }
    // Look for explicit "running" signal
    if (line.includes('Press Ctrl+C to stop')) {
      share.status = 'running'
    }
    // Error patterns
    if (line.includes('TorError') || line.includes("Can't connect") || line.includes('error while attempting to connect')) {
      share.status = 'error'
    }
  }

  proc.stdout?.on('data', (data: Buffer) => {
    const text = data.toString('utf8')
    // Split on \r OR \n because onionshare uses \r for progress bars
    text.split(/[\r\n]+/).forEach((line) => onLine(line))
  })
  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString('utf8')
    text.split(/[\r\n]+/).forEach((line) => onLine('[stderr] ' + line))
  })

  proc.on('error', (err) => {
    share.status = 'error'
    share.outputLog.push(`[spawn error] ${err.message}`)
  })
  proc.on('exit', (code) => {
    if (share.status !== 'error') share.status = 'stopped'
    share.outputLog.push(`[exit] code=${code}`)
    share.process = null
  })
}

interface CreateBody {
  mode?: 'share' | 'receive' | 'website'
  files?: string[]  // absolute paths in /home/z/my-project/user-files/
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  ensureStateDir()

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const mode = body.mode ?? 'share'
  if (!['share', 'receive', 'website'].includes(mode)) {
    return NextResponse.json({ error: 'invalid mode' }, { status: 400 })
  }

  // Validate files
  const files = (body.files ?? []).filter(Boolean)
  if (mode !== 'receive' && files.length === 0) {
    return NextResponse.json({ error: 'at least one file is required for share/website mode' }, { status: 400 })
  }

  // Security: ensure files are inside user-files
  const SANDBOX = '/home/z/my-project/user-files'
  for (const f of files) {
    const resolved = path.resolve(f)
    if (!resolved.startsWith(SANDBOX + '/') && resolved !== SANDBOX) {
      return NextResponse.json({ error: `file must be inside user-files: ${f}` }, { status: 403 })
    }
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: `file not found: ${f}` }, { status: 404 })
    }
  }

  const id = makeId()

  const share: RunningShare = {
    id,
    mode,
    files,
    onionUrl: null,
    privateKey: null,
    status: 'starting',
    startedAt: Date.now(),
    pid: null,
    process: null,
    outputLog: [],
  }
  shares.set(id, share)

  // Kick off the actual share — updates the share object as it boots
  try {
    startOnionshare(id, mode, files)
  } catch (err) {
    share.status = 'error'
    share.outputLog.push(`[error] ${(err as Error).message}`)
    return NextResponse.json({ error: (err as Error).message, id }, { status: 500 })
  }

  return NextResponse.json({
    id,
    mode,
    files,
    status: 'starting',
    message: 'OnionShare is starting — poll /api/onionshare/list?id=... for the .onion URL (takes 20-30s for Tor bootstrap)',
  })
}

// Allow GET too for convenience (returns same as POST with query params)
export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError
  const mode = (req.nextUrl.searchParams.get('mode') ?? 'share') as 'share' | 'receive' | 'website'
  const filesParam = req.nextUrl.searchParams.get('files') ?? ''
  const files = filesParam ? filesParam.split(',').filter(Boolean) : []

  return POST(new NextRequest(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, files }),
  }))
}

// Export the shares map so other routes can access it
export { shares as _shares }
