import { NextResponse } from 'next/server'
import net from 'node:net'
import https from 'node:https'
import http from 'node:http'
import { SocksProxyAgent } from 'socks-proxy-agent'
import fs from 'node:fs'
import { requireAuth } from '@/lib/auth-middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOCKS_HOST = '127.0.0.1'
const SOCKS_PORT = 9050
const CONTROL_PORT = 9051
const TOR_LOG = '/home/z/my-project/tor/tor-stdout.log'

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    sock.setTimeout(1500)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(false)
    })
    sock.connect(port, host)
  })
}

/** Parse the latest "Bootstrapped N%" line from the tor log. */
function parseBootstrap(): { percent: number; tag: string; status: string } | null {
  try {
    const log = fs.readFileSync(TOR_LOG, 'utf8')
    // Lines look like: "Jun 18 21:46:24.000 [notice] Bootstrapped 100% (done): Done"
    const matches = log.match(/Bootstrapped (\d+)% \(([^)]+)\): (.+)$/gm)
    if (!matches || matches.length === 0) return null
    const last = matches[matches.length - 1]
    const m = last.match(/Bootstrapped (\d+)% \(([^)]+)\): (.+)$/)
    if (!m) return null
    return { percent: parseInt(m[1], 10), tag: m[2], status: m[3] }
  } catch {
    return null
  }
}

function fetchViaTor(url: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    let resolved = false
    const agent = new SocksProxyAgent(`socks5h://${SOCKS_HOST}:${SOCKS_PORT}`)
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { agent, timeout: timeoutMs } as https.RequestOptions, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        resolved = true
        resolve(body)
      })
    })
    req.on('error', (err) => {
      if (!resolved) reject(err)
    })
    req.on('timeout', () => {
      if (!resolved) {
        req.destroy()
        reject(new Error('timeout'))
      }
    })
  })
}

export async function GET() {
  const [socksOpen, controlOpen] = await Promise.all([
    isPortOpen(SOCKS_HOST, SOCKS_PORT),
    isPortOpen(SOCKS_HOST, CONTROL_PORT),
  ])

  const bootstrap = parseBootstrap()
  const ready = socksOpen && bootstrap?.percent === 100

  // If ready, also fetch the current exit IP (best-effort, don't block)
  let exitIp: string | null = null
  if (ready) {
    try {
      const body = await fetchViaTor('https://check.torproject.org/api/ip')
      const data = JSON.parse(body)
      exitIp = data.IP ?? null
    } catch {
      // ignore — IP check failed
    }
  }

  return NextResponse.json({
    socksOpen,
    controlOpen,
    bootstrap,
    ready,
    exitIp,
    socksPort: SOCKS_PORT,
    controlPort: CONTROL_PORT,
  })
}
